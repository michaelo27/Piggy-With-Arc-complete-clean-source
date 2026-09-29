// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Arc Savings Jar
 * @notice A time-locked USDC savings jar deployed on Arc. Every wallet can run
 *         several jars at once (up to `MAX_JARS_PER_WALLET`), each with its own
 *         name, amount, optional target and lock period - e.g. "Vacation" and "Car fund".
 *
 * @dev Base flow
 *      1. User approves this contract to spend USDC.
 *      2. User calls `createJar(amount, duration, jarName, targetAmount)`.
 *         The USDC moves from the user into this contract and is locked.
 *      3. When `block.timestamp >= unlockTime` the user calls
 *         `withdrawJar(jarId)` and receives their deposit back in full, plus
 *         whatever this jar earned - see "Incentives" below.
 *      4. If the user cannot wait, `breakJar(jarId)` returns 90% immediately
 *         and keeps 10% in the contract as a "discipline fee". That fee is
 *         what funds the reward pool for everyone else (see below) - the
 *         jar that breaks earns nothing from it.
 *
 * @dev Incentives - three mechanisms, all paid only on a MATURE withdrawal
 *      (never on an early break, which keeps the "discipline" story intact):
 *
 *      1. Share-of-penalty reward. 80% of every 10% penalty (i.e. 8% of the
 *         broken jar's amount) is added to a reward pool that is split among
 *         everyone who still has an active jar at that moment, in proportion
 *         to their deposit. This uses the standard "accumulator" pattern
 *         (`accRewardPerShare` + a per-jar `rewardDebt` baseline) so the
 *         split is exact and needs no loop over other users' jars. The other
 *         20% of the penalty goes to `ownerFeesAccrued` for the protocol.
 *         Self-funding: nothing this pays out was not first paid in by
 *         someone who broke a jar early.
 *
 *      2. Time-weighted bonus. A simple-interest bonus, `bonusAprBps` per
 *         year (owner-adjustable, capped at `MAX_BONUS_APR_BPS`), on the
 *         amount held, for the seconds actually held. This is NOT
 *         self-funding - it is paid out of `bonusPoolBalance`, which anyone
 *         can top up with `fundBonusPool()`. If the pool runs low, the bonus
 *         paid is capped at whatever remains, so the contract can never go
 *         insolvent over this.
 *
 *      3. Points. Every mature withdrawal earns "USDC-days held"
 *         (amount x days, roughly - see `withdrawJar`) as non-transferable
 *         points, tracked forever in `points[user]`. `getTier(user)` turns
 *         a point total into a simple Bronze/Silver/Gold/Platinum tier the
 *         UI can show as a badge. Points cost the contract nothing to award.
 *
 * @dev Accounting: the contract's USDC balance is split into four buckets
 *      that always add up exactly (checked in tests / `getAccountingSummary`):
 *        balance == totalActiveDeposits + ownerFeesAccrued
 *                    + rewardPoolBalance + bonusPoolBalance
 *      Each bucket is tracked explicitly rather than derived, because with
 *      three buckets sharing one balance a derived "leftover" formula can no
 *      longer tell them apart. One side effect worth knowing: USDC sent to
 *      this contract directly (not through `createJar`, `breakJar` or
 *      `fundBonusPool`) is *not* claimable by the owner or anyone else - the
 *      explicit buckets above don't count it, so it just becomes inert slack
 *      that no function ever reads.
 *
 * @dev Security model (unchanged)
 *      - Checks-Effects-Interactions on every function that moves tokens.
 *      - Optimistic reentrancy guard (`_locked`) on every state-changing call.
 *      - ERC20 return values are checked (USDC returns `true`, but some
 *        clones do not return anything at all -> `safeTransfer` handles both).
 *      - A jar can only ever be closed by the wallet that owns it.
 *
 * @dev Note on Arc: gas on Arc is paid in native USDC (18 decimals).
 *      The ERC-20 USDC token handled by this contract has 6 decimals.
 */

/// @notice Minimal ERC-20 surface used by this contract (keeps it dependency-free).
interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);

    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    function balanceOf(address account) external view returns (uint256);
}

contract SavingsJar {
    // =========================================================================
    // Types
    // =========================================================================

    enum ActivityType {
        JarCreated,
        SelfTopUp,
        ContributionSent,
        ContributionReceived,
        WithdrawnAtMaturity,
        WithdrawnAtTarget,
        JarBroken,
        TargetReached,
        BonusPoolFunded
    }

    struct ActivityData {
        ActivityType activityType;
        address actor;
        address counterparty;
        uint256 jarId;
        uint256 amount;
        uint256 timestamp;
    }

    struct JarData {
        uint256 amount;              // Total USDC saved, raw units (6 decimals)
        uint256 unlockTime;          // Unix timestamp when the jar matures
        uint256 createdAt;           // Original jar creation timestamp
        uint256 rewardDebt;          // Reward-accumulator baseline
        uint256 weightedDepositTime; // Amount-weighted timestamp for bonus/points fairness
        uint256 targetAmount;        // Optional savings target (0 = time-only)
        bool isActive;               // Whether this slot currently holds an active jar
        string jarName;              // User supplied label
    }

    // =========================================================================
    // Constants
    // =========================================================================

    /// @notice Shortest allowed lock: 24 hours.
    uint256 public constant MIN_LOCK_DURATION = 86_400; // 1 day
    /// @notice Longest allowed lock: 365 days.
    uint256 public constant MAX_LOCK_DURATION = 31_536_000; // 365 days
    /// @notice Basis-point denominator used for the early-exit penalty.
    uint256 public constant PENALTY_DENOMINATOR = 10; // => 1/10 == 10% of the jar
    /// @notice Hard cap on the jar label length (protects against gas griefing).
    uint256 public constant MAX_NAME_LENGTH = 48;
    /// @notice Most jars a single wallet can hold open at the same time.
    uint256 public constant MAX_JARS_PER_WALLET = 10;

    /// @notice Basis-point denominator used everywhere below (10_000 = 100%).
    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// @notice Share of every broken jar's penalty that goes to the protocol
    ///         (`ownerFeesAccrued`). The remainder (80%) funds the reward pool.
    uint256 public constant OWNER_PENALTY_SHARE_BPS = 2_000; // 20% of the 10% penalty = 2% of the jar
    /// @notice Ceiling on the owner-adjustable time bonus, so it can never be set unreasonably high.
    uint256 public constant MAX_BONUS_APR_BPS = 2_000; // 20% APR ceiling
    /// @notice Fixed-point precision used by the reward accumulator (standard "AccRewardPerShare" pattern).
    uint256 private constant ACC_PRECISION = 1e18;
    /// @notice Used to convert the annual bonus rate into a per-second rate.
    uint256 private constant SECONDS_PER_YEAR = 365 days;
    /// @notice USDC has 6 decimals; used only for the points ("USDC-days") formula.
    uint256 private constant USDC_UNIT = 1e6;

    /// @notice Point thresholds for `getTier()`. Illustrative starting values - easy to
    ///         recalibrate later since tiers are computed, not stored.
    uint256 public constant SILVER_POINTS = 1_000;   // e.g. ~100 USDC held a full 10 days
    uint256 public constant GOLD_POINTS = 10_000;
    uint256 public constant PLATINUM_POINTS = 50_000;

    // =========================================================================
    // Storage
    // =========================================================================

    /// @notice USDC token used for deposits. Set once, never changes.
    IERC20Minimal public immutable usdc;

    /// @notice Contract owner (deployer). May sweep `ownerFeesAccrued` and tune the bonus rate.
    address public owner;

    /// @notice Jar slots per wallet (at most `MAX_JARS_PER_WALLET` entries).
    mapping(address => JarData[]) public jars;

    /// @dev Durable, wallet-specific savings history. Publicly readable through
    ///      the bounded `getRecentActivities` view.
    mapping(address => ActivityData[]) private _activities;

    /// @notice Sum of every currently active deposit (raw USDC units). Also the
    ///         "total shares" denominator for the reward accumulator.
    uint256 public totalActiveDeposits;

    // ---- Incentive 1: share-of-penalty reward ----------------------------------
    /// @notice Cumulative reward per unit deposited, scaled by `ACC_PRECISION`.
    ///         Grows every time a jar is broken. See `pendingReward`.
    uint256 public accRewardPerShare;
    /// @notice USDC currently reserved for active jars' unclaimed rewards.
    uint256 public rewardPoolBalance;

    // ---- Incentive 2: time-weighted bonus ---------------------------------------
    /// @notice Simple-interest annual rate paid on the time a jar is held, in basis points.
    uint256 public bonusAprBps = 500; // default 5% / year
    /// @notice USDC available to pay bonuses. Funded by `fundBonusPool()`; never overdrawn.
    uint256 public bonusPoolBalance;

    // ---- Incentive 3: points / tiers ---------------------------------------------
    /// @notice Non-transferable lifetime points per wallet ("USDC-days" held to maturity).
    mapping(address => uint256) public points;
    /// @notice Lifetime points awarded across every wallet. Analytics only.
    uint256 public totalPointsAwarded;

    // ---- Protocol fees -------------------------------------------------------------
    /// @notice USDC the owner may sweep with `withdrawPenalties()`.
    uint256 public ownerFeesAccrued;

    // ---- Lifetime counters (analytics only, no logic depends on these) ----------
    uint256 public totalJarsCreated;
    uint256 public totalWithdrawn;       // principal only
    uint256 public totalBrokenReturned;  // principal only
    uint256 public totalPenaltiesCollected; // lifetime penalty, owner + reward combined
    uint256 public totalRewardsPaid;
    uint256 public totalBonusPaid;
    uint256 public totalTopUps;          // lifetime principal added after creation

    /// @dev Optimistic reentrancy flag.
    bool private _locked;

    // =========================================================================
    // Events
    // =========================================================================

    event ActivityRecorded(
        address indexed wallet,
        uint256 indexed activityIndex,
        ActivityType indexed activityType,
        address actor,
        address counterparty,
        uint256 jarId,
        uint256 amount,
        uint256 timestamp
    );

    event JarCreated(
        address indexed user,
        uint256 indexed jarId,
        uint256 amount,
        uint256 unlockTime,
        string jarName,
        uint256 targetAmount
    );
    event JarFunded(
        address indexed contributor,
        address indexed jarOwner,
        uint256 indexed jarId,
        uint256 amount,
        uint256 newBalance
    );
    event JarTargetReached(
        address indexed jarOwner,
        uint256 indexed jarId,
        uint256 targetAmount,
        uint256 totalSaved
    );
    event JarWithdrawn(
        address indexed user,
        uint256 indexed jarId,
        uint256 amount,
        uint256 reward,
        uint256 bonus,
        uint256 pointsEarned
    );
    event TargetWithdrawal(
        address indexed user,
        uint256 indexed jarId,
        uint256 principal,
        uint256 forfeitedReward
    );
    event JarBroken(
        address indexed user,
        uint256 indexed jarId,
        uint256 penalty,
        uint256 returned,
        uint256 rewardContributed
    );
    event PenaltiesWithdrawn(address indexed owner, uint256 amount);
    event BonusPoolFunded(address indexed funder, uint256 amount);
    event BonusPoolWithdrawn(address indexed owner, uint256 amount);
    event BonusAprUpdated(uint256 previousBps, uint256 newBps);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // =========================================================================
    // Modifiers
    // =========================================================================

    /// @dev Simple, dependency-light reentrancy guard.
    modifier nonReentrant() {
        require(!_locked, "ReentrancyGuard: reentrant call");
        _locked = true;
        _;
        _locked = false;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "SavingsJar: caller is not the owner");
        _;
    }

    // =========================================================================
    // Constructor
    // =========================================================================

    /**
     * @param _usdcAddress USDC ERC-20 contract on the target chain.
     *                     Arc: 0x3600000000000000000000000000000000000000
     */
    constructor(address _usdcAddress) {
        require(_usdcAddress != address(0), "SavingsJar: USDC address is zero");
        usdc = IERC20Minimal(_usdcAddress);
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // =========================================================================
    // Write functions - jars
    // =========================================================================

    /**
     * @notice Lock `_amount` of USDC for `_lockDurationInSeconds` in a new jar.
     * @dev    Caller must have approved this contract for at least `_amount`.
     *         Reverts when the wallet already has `MAX_JARS_PER_WALLET` active jars.
     */
    function createJar(
        uint256 _amount,
        uint256 _lockDurationInSeconds,
        string memory _jarName,
        uint256 _targetAmount
    ) external nonReentrant returns (uint256 jarId) {
        // ---------------- Checks ----------------
        require(_amount > 0, "SavingsJar: amount must be greater than 0");
        require(
            _lockDurationInSeconds >= MIN_LOCK_DURATION,
            "SavingsJar: lock must be at least 24 hours"
        );
        require(
            _lockDurationInSeconds <= MAX_LOCK_DURATION,
            "SavingsJar: lock cannot exceed 365 days"
        );
        require(bytes(_jarName).length > 0, "SavingsJar: jar name cannot be empty");
        require(bytes(_jarName).length <= MAX_NAME_LENGTH, "SavingsJar: jar name too long (48 max)");
        require(
            _targetAmount == 0 || _targetAmount > _amount,
            "SavingsJar: target must exceed initial deposit"
        );

        JarData[] storage userJars = jars[msg.sender];

        // Reuse the first closed slot; otherwise append a new one (bounded by the cap).
        jarId = userJars.length;
        for (uint256 i = 0; i < userJars.length; i++) {
            if (!userJars[i].isActive) {
                jarId = i;
                break;
            }
        }
        if (jarId == userJars.length) {
            require(userJars.length < MAX_JARS_PER_WALLET, "SavingsJar: jar limit reached (10 max)");
            userJars.push();
        }

        // ---------------- Effects ----------------
        uint256 unlockTime = block.timestamp + _lockDurationInSeconds;
        JarData storage jar = userJars[jarId];
        jar.amount = _amount;
        jar.unlockTime = unlockTime;
        jar.createdAt = block.timestamp;
        jar.weightedDepositTime = block.timestamp;
        jar.targetAmount = _targetAmount;
        jar.jarName = _jarName;
        jar.isActive = true;
        // Baseline the reward accumulator now, so this jar only earns rewards
        // from penalties paid *after* it joined, never retroactively.
        jar.rewardDebt = (_amount * accRewardPerShare) / ACC_PRECISION;

        totalActiveDeposits += _amount;
        totalJarsCreated += 1;

        // ---------------- Interactions ----------------
        _safeTransferFrom(address(usdc), msg.sender, address(this), _amount);

        emit JarCreated(msg.sender, jarId, _amount, unlockTime, _jarName, _targetAmount);
        _recordActivity(
            msg.sender,
            ActivityType.JarCreated,
            msg.sender,
            address(0),
            jarId,
            _amount
        );
    }

    /**
     * @notice Add USDC to an existing jar before maturity. Anyone may
     *         contribute. Contributions are irreversible gifts controlled by
     *         the jar owner.
     * @dev New principal receives a fresh reward-debt baseline so it cannot
     *      claim penalties distributed before this top-up. The weighted
     *      timestamp prevents top-ups receiving retroactive time bonus/points.
     */
    function addToJar(
        address _jarOwner,
        uint256 _jarId,
        uint256 _amount
    ) external nonReentrant {
        require(_jarOwner != address(0), "SavingsJar: jar owner is zero address");
        require(_jarId < jars[_jarOwner].length, "SavingsJar: invalid jar id");
        JarData storage jar = jars[_jarOwner][_jarId];
        require(jar.isActive, "SavingsJar: destination has no active jar");
        require(_amount > 0, "SavingsJar: top-up amount must be greater than 0");
        require(block.timestamp < jar.unlockTime, "SavingsJar: jar already matured");

        bool targetWasReached = _isTargetReached(jar);
        uint256 oldAmount = jar.amount;
        uint256 newAmount = oldAmount + _amount;

        // Preserve exact amount-weighted holding time for bonus/points.
        jar.weightedDepositTime =
            ((oldAmount * jar.weightedDepositTime) + (_amount * block.timestamp)) /
            newAmount;
        // New money starts earning reward share only from this block onward.
        jar.rewardDebt += (_amount * accRewardPerShare) / ACC_PRECISION;
        jar.amount = newAmount;
        totalActiveDeposits += _amount;
        totalTopUps += _amount;

        _safeTransferFrom(address(usdc), msg.sender, address(this), _amount);

        emit JarFunded(msg.sender, _jarOwner, _jarId, _amount, newAmount);
        if (msg.sender == _jarOwner) {
            _recordActivity(
                _jarOwner,
                ActivityType.SelfTopUp,
                msg.sender,
                address(0),
                _jarId,
                _amount
            );
        } else {
            _recordActivity(
                msg.sender,
                ActivityType.ContributionSent,
                msg.sender,
                _jarOwner,
                _jarId,
                _amount
            );
            _recordActivity(
                _jarOwner,
                ActivityType.ContributionReceived,
                msg.sender,
                msg.sender,
                _jarId,
                _amount
            );
        }
        if (!targetWasReached && _isTargetReached(jar)) {
            emit JarTargetReached(_jarOwner, _jarId, jar.targetAmount, newAmount);
            _recordActivity(
                _jarOwner,
                ActivityType.TargetReached,
                msg.sender,
                msg.sender == _jarOwner ? address(0) : msg.sender,
                _jarId,
                newAmount
            );
        }
    }

    /**
     * @notice Withdraw jar `_jarId` once its lock has expired. Pays the full
     *         principal plus this jar's share of the reward pool, plus its
     *         time-weighted bonus (if the bonus pool has funds), and credits
     *         points for the time held.
     */
    function withdrawJar(uint256 _jarId) external nonReentrant {
        JarData[] storage userJars = jars[msg.sender];

        require(_jarId < userJars.length, "SavingsJar: invalid jar id");
        JarData storage jar = userJars[_jarId];
        require(jar.isActive, "SavingsJar: no active jar to withdraw");

        bool matured = block.timestamp >= jar.unlockTime;
        bool targetReached = _isTargetReached(jar);
        require(matured || targetReached, "SavingsJar: jar locked and target not reached");

        uint256 amount = jar.amount;
        uint256 reward;
        uint256 bonus;
        uint256 pointsEarned;
        uint256 forfeitedReward;

        if (matured) {
            // Mature jars receive all three existing incentives.
            reward = (amount * accRewardPerShare) / ACC_PRECISION - jar.rewardDebt;
            uint256 weightedHeldSeconds = block.timestamp - jar.weightedDepositTime;
            bonus =
                (amount * bonusAprBps * weightedHeldSeconds) /
                (BPS_DENOMINATOR * SECONDS_PER_YEAR);
            if (bonus > bonusPoolBalance) bonus = bonusPoolBalance;
            pointsEarned = (amount * weightedHeldSeconds) / (USDC_UNIT * 1 days);
        } else {
            // Reaching a target unlocks principal early without a penalty, but
            // waiting to maturity is still rewarded. The pending reward share
            // is redistributed to jars that remain disciplined.
            uint256 accrued = (amount * accRewardPerShare) / ACC_PRECISION;
            if (accrued > jar.rewardDebt) forfeitedReward = accrued - jar.rewardDebt;
        }

        delete userJars[_jarId];
        totalActiveDeposits -= amount;
        totalWithdrawn += amount;

        if (matured) {
            rewardPoolBalance -= reward;
            bonusPoolBalance -= bonus;
            points[msg.sender] += pointsEarned;
            totalPointsAwarded += pointsEarned;
            totalRewardsPaid += reward;
            totalBonusPaid += bonus;
        } else if (forfeitedReward > 0) {
            if (totalActiveDeposits > 0) {
                // Pool balance stays unchanged; only entitlement moves to the
                // remaining principal through the accumulator.
                accRewardPerShare +=
                    (forfeitedReward * ACC_PRECISION) /
                    totalActiveDeposits;
            } else {
                // No active saver can receive it, so move this explicit bucket
                // into owner fees to keep accounting exact.
                rewardPoolBalance -= forfeitedReward;
                ownerFeesAccrued += forfeitedReward;
            }
        }

        uint256 payout = amount + reward + bonus;
        _safeTransfer(address(usdc), msg.sender, payout);

        _recordActivity(
            msg.sender,
            matured ? ActivityType.WithdrawnAtMaturity : ActivityType.WithdrawnAtTarget,
            msg.sender,
            address(0),
            _jarId,
            payout
        );
        emit JarWithdrawn(msg.sender, _jarId, amount, reward, bonus, pointsEarned);
        if (!matured) {
            emit TargetWithdrawal(msg.sender, _jarId, amount, forfeitedReward);
        }
    }

    /**
     * @notice Emergency exit for jar `_jarId` before its unlock time. Pays 90% of
     *         the deposit immediately. The other 10% never leaves the contract:
     *         20% of it becomes an owner-sweepable fee, 80% funds the reward
     *         pool for everyone whose jar is still open (Incentive 1). This jar
     *         earns nothing from either bucket - breaking early forfeits rewards.
     */
    function breakJar(uint256 _jarId) external nonReentrant {
        JarData[] storage userJars = jars[msg.sender];

        // ---------------- Checks ----------------
        require(_jarId < userJars.length, "SavingsJar: invalid jar id");
        JarData storage jar = userJars[_jarId];
        require(jar.isActive, "SavingsJar: no active jar to break");
        require(block.timestamp < jar.unlockTime, "SavingsJar: jar already matured, use withdrawJar");
        require(!_isTargetReached(jar), "SavingsJar: target reached, use withdrawJar");

        // ---------------- Effects ----------------
        uint256 amount = jar.amount;
        uint256 penalty = amount / PENALTY_DENOMINATOR;
        uint256 returned = amount - penalty;

        delete userJars[_jarId];
        // Remove this jar's weight *before* splitting the penalty, so the penalty
        // is shared only among the jars that are actually still open afterwards.
        totalActiveDeposits -= amount;
        totalBrokenReturned += returned;
        totalPenaltiesCollected += penalty;

        uint256 ownerCut = (penalty * OWNER_PENALTY_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 rewardCut = penalty - ownerCut;

        if (totalActiveDeposits > 0) {
            accRewardPerShare += (rewardCut * ACC_PRECISION) / totalActiveDeposits;
            rewardPoolBalance += rewardCut;
        } else {
            // Nobody left to share with right now - keep it simple and send this
            // portion to the protocol instead of leaving it unassigned.
            ownerCut += rewardCut;
            rewardCut = 0;
        }
        ownerFeesAccrued += ownerCut;

        // ---------------- Interactions ----------------
        _safeTransfer(address(usdc), msg.sender, returned);

        emit JarBroken(msg.sender, _jarId, penalty, returned, rewardCut);
        _recordActivity(
            msg.sender,
            ActivityType.JarBroken,
            msg.sender,
            address(0),
            _jarId,
            returned
        );
    }

    // =========================================================================
    // Write functions - incentive pools & admin
    // =========================================================================

    /**
     * @notice Top up the time-bonus pool (Incentive 2). Callable by anyone -
     *         the owner, a grant program, or the community can fund it.
     *         Requires an ERC-20 approval for `_amount` first.
     */
    function fundBonusPool(uint256 _amount) external nonReentrant {
        require(_amount > 0, "SavingsJar: amount must be greater than 0");
        bonusPoolBalance += _amount;
        _safeTransferFrom(address(usdc), msg.sender, address(this), _amount);
        emit BonusPoolFunded(msg.sender, _amount);
        _recordActivity(
            msg.sender,
            ActivityType.BonusPoolFunded,
            msg.sender,
            address(0),
            type(uint256).max,
            _amount
        );
    }

    /**
     * @notice Owner-only: reclaim bonus-pool USDC that hasn't been promised to
     *         anyone yet (no jar has an unpaid claim on it - the pool is only
     *         ever debited when a jar is actually withdrawn).
     */
    function withdrawUnusedBonus(uint256 _amount) external onlyOwner nonReentrant {
        require(_amount > 0 && _amount <= bonusPoolBalance, "SavingsJar: invalid amount");
        bonusPoolBalance -= _amount;
        _safeTransfer(address(usdc), owner, _amount);
        emit BonusPoolWithdrawn(owner, _amount);
    }

    /// @notice Owner-only: adjust the time-bonus rate, capped at `MAX_BONUS_APR_BPS`.
    function setBonusApr(uint256 _newBps) external onlyOwner {
        require(_newBps <= MAX_BONUS_APR_BPS, "SavingsJar: bonus APR too high");
        emit BonusAprUpdated(bonusAprBps, _newBps);
        bonusAprBps = _newBps;
    }

    /// @notice Owner-only sweep of the protocol's accrued fee share (see `breakJar`).
    function withdrawPenalties() external onlyOwner nonReentrant {
        uint256 amount = ownerFeesAccrued;
        require(amount > 0, "SavingsJar: no penalties to withdraw");

        ownerFeesAccrued = 0;
        _safeTransfer(address(usdc), owner, amount);

        emit PenaltiesWithdrawn(owner, amount);
    }

    /// @notice Transfer ownership of the admin rights above.
    function transferOwnership(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), "SavingsJar: new owner is zero address");
        emit OwnershipTransferred(owner, _newOwner);
        owner = _newOwner;
    }

    // =========================================================================
    // View functions - jars
    // =========================================================================

    /// @notice Every jar slot of `_user` (active and closed). Filter on `isActive`.
    function getJars(address _user) external view returns (JarData[] memory) {
        return jars[_user];
    }

    /// @notice One jar slot. Returns an empty (inactive) jar for an unknown id.
    function getJar(address _user, uint256 _jarId) external view returns (JarData memory) {
        if (_jarId >= jars[_user].length) {
            JarData memory empty;
            return empty;
        }
        return jars[_user][_jarId];
    }

    /// @notice Seconds remaining until jar `_jarId` unlocks. 0 if closed, unknown, or already matured.
    function getTimeRemaining(address _user, uint256 _jarId) external view returns (uint256) {
        if (_jarId >= jars[_user].length) return 0;
        JarData storage jar = jars[_user][_jarId];
        if (!jar.isActive) return 0;
        if (block.timestamp >= jar.unlockTime) return 0;
        return jar.unlockTime - block.timestamp;
    }

    /// @notice Whether a jar has reached its optional nonzero savings target.
    function isTargetReached(address _user, uint256 _jarId) external view returns (bool) {
        if (_jarId >= jars[_user].length) return false;
        return _isTargetReached(jars[_user][_jarId]);
    }

    /// @notice Whether the owner may withdraw principal penalty-free now.
    function canWithdraw(address _user, uint256 _jarId) external view returns (bool) {
        if (_jarId >= jars[_user].length) return false;
        JarData storage jar = jars[_user][_jarId];
        return jar.isActive && (block.timestamp >= jar.unlockTime || _isTargetReached(jar));
    }

    /// @notice Number of jar slots `_user` has ever opened (active + closed).
    function getJarCount(address _user) external view returns (uint256) {
        return jars[_user].length;
    }

    /// @notice Number of jars `_user` currently has open.
    function getActiveJarCount(address _user) external view returns (uint256 count) {
        JarData[] storage userJars = jars[_user];
        for (uint256 i = 0; i < userJars.length; i++) {
            if (userJars[i].isActive) count += 1;
        }
    }

    /// @notice Total number of durable activity records for a wallet.
    function getActivityCount(address _user) external view returns (uint256) {
        return _activities[_user].length;
    }

    /// @notice At most `_limit` newest activity records, returned oldest-to-newest.
    /// @dev The hard cap keeps accidental eth_call responses bounded.
    function getRecentActivities(
        address _user,
        uint256 _limit
    ) external view returns (ActivityData[] memory recent) {
        uint256 total = _activities[_user].length;
        uint256 count = _limit > 100 ? 100 : _limit;
        if (count > total) count = total;
        recent = new ActivityData[](count);
        uint256 start = total - count;
        for (uint256 i = 0; i < count; i++) {
            recent[i] = _activities[_user][start + i];
        }
    }

    // =========================================================================
    // View functions - incentives
    // =========================================================================

    /**
     * @notice How much reward jar `_jarId` would receive right now if withdrawn
     *         (Incentive 1). Grows only when someone else breaks a jar.
     */
    function pendingReward(address _user, uint256 _jarId) external view returns (uint256) {
        if (_jarId >= jars[_user].length) return 0;
        JarData storage jar = jars[_user][_jarId];
        if (!jar.isActive) return 0;
        uint256 accrued = (jar.amount * accRewardPerShare) / ACC_PRECISION;
        if (accrued <= jar.rewardDebt) return 0;
        return accrued - jar.rewardDebt;
    }

    /**
     * @notice The time-weighted bonus jar `_jarId` would receive right now
     *         (Incentive 2), already capped at the pool's remaining balance.
     */
    function previewBonus(address _user, uint256 _jarId) external view returns (uint256) {
        if (_jarId >= jars[_user].length) return 0;
        JarData storage jar = jars[_user][_jarId];
        if (!jar.isActive) return 0;
        uint256 heldSeconds = block.timestamp > jar.weightedDepositTime
            ? block.timestamp - jar.weightedDepositTime
            : 0;
        uint256 bonus = (jar.amount * bonusAprBps * heldSeconds) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
        return bonus > bonusPoolBalance ? bonusPoolBalance : bonus;
    }

    /**
     * @notice Turns `_user`'s lifetime points into a tier: 0 = Bronze, 1 = Silver,
     *         2 = Gold, 3 = Platinum. Purely a read - costs nothing to compute.
     */
    function getTier(address _user) external view returns (uint8) {
        uint256 p = points[_user];
        if (p >= PLATINUM_POINTS) return 3;
        if (p >= GOLD_POINTS) return 2;
        if (p >= SILVER_POINTS) return 1;
        return 0;
    }

    /**
     * @notice The four buckets that make up the contract's USDC balance, plus
     *         the balance itself, so the invariant
     *         `balance == active + ownerFees + rewardPool + bonusPool`
     *         can be checked from outside in one call.
     */
    function getAccountingSummary()
        external
        view
        returns (
            uint256 balance,
            uint256 activeDeposits,
            uint256 ownerFees,
            uint256 rewardPool,
            uint256 bonusPool
        )
    {
        balance = IERC20Minimal(address(usdc)).balanceOf(address(this));
        activeDeposits = totalActiveDeposits;
        ownerFees = ownerFeesAccrued;
        rewardPool = rewardPoolBalance;
        bonusPool = bonusPoolBalance;
    }

    /// @notice Kept for interface stability with earlier revisions: same as `ownerFeesAccrued`.
    function getAccumulatedPenalties() external view returns (uint256) {
        return ownerFeesAccrued;
    }

    // =========================================================================
    // Internal helpers
    // =========================================================================

    /**
     * @dev `transferFrom` that (a) tolerates non-standard ERC-20s which return
     *      nothing and (b) bubbles the token's own revert reason up to the user,
     *      so the wallet shows "insufficient allowance" instead of an opaque
     *      "transferFrom failed".
     */
    function _recordActivity(
        address wallet,
        ActivityType activityType,
        address actor,
        address counterparty,
        uint256 jarId,
        uint256 amount
    ) internal {
        uint256 index = _activities[wallet].length;
        _activities[wallet].push(
            ActivityData({
                activityType: activityType,
                actor: actor,
                counterparty: counterparty,
                jarId: jarId,
                amount: amount,
                timestamp: block.timestamp
            })
        );
        emit ActivityRecorded(
            wallet,
            index,
            activityType,
            actor,
            counterparty,
            jarId,
            amount,
            block.timestamp
        );
    }

    function _isTargetReached(JarData storage jar) internal view returns (bool) {
        return jar.isActive && jar.targetAmount > 0 && jar.amount >= jar.targetAmount;
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeCall(IERC20Minimal.transferFrom, (from, to, value))
        );
        if (!ok) _bubbleUp(data, "SavingsJar: transferFrom failed");
        require(data.length == 0 || abi.decode(data, (bool)), "SavingsJar: transferFrom returned false");
    }

    /// @dev `transfer` counterpart of `_safeTransferFrom`.
    function _safeTransfer(address token, address to, uint256 value) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeCall(IERC20Minimal.transfer, (to, value))
        );
        if (!ok) _bubbleUp(data, "SavingsJar: transfer failed");
        require(data.length == 0 || abi.decode(data, (bool)), "SavingsJar: transfer returned false");
    }

    /// @dev Re-revert with the token's reason when it ABI-encoded one (Error(string)).
    function _bubbleUp(bytes memory returnData, string memory fallbackReason) private pure {
        if (returnData.length >= 68) {
            // solc reverts as: Error(string) selector + offset + length + data
            assembly {
                returnData := add(returnData, 0x04) // strip the length prefix
            }
            revert(abi.decode(returnData, (string)));
        }
        revert(fallbackReason);
    }
}
