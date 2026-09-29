const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const APP = path.join(ROOT, "arc-savings-jar");
const EVM_NODE = path.join(__dirname, "node_modules");
const { VM } = require(path.join(EVM_NODE, "@nomicfoundation/ethereumjs-vm"));
const { Common, Hardfork, Chain } = require(path.join(EVM_NODE, "@nomicfoundation/ethereumjs-common"));
const { Block } = require(path.join(EVM_NODE, "@nomicfoundation/ethereumjs-block"));
const { Address, privateToAddress, hexToBytes, bytesToHex, Account } = require(path.join(EVM_NODE, "@nomicfoundation/ethereumjs-util"));
const { Message } = require(path.join(EVM_NODE, "@nomicfoundation/ethereumjs-evm"));
const solc = require(path.join(APP, "node_modules/solc"));
const { encodeAbiParameters, encodeFunctionData, decodeFunctionResult, decodeErrorResult } = require(path.join(APP, "node_modules/viem"));

const artifact = JSON.parse(fs.readFileSync(path.join(APP, "artifacts/SavingsJar.json"), "utf8"));
const mockSource = fs.readFileSync(path.join(__dirname, "MockUSDC.sol"), "utf8");
const compiledMock = JSON.parse(solc.compile(JSON.stringify({
  language: "Solidity",
  sources: { "MockUSDC.sol": { content: mockSource } },
  settings: { evmVersion: "paris", optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
})));
if (compiledMock.errors) for (const error of compiledMock.errors) if (error.severity === "error") throw new Error(error.formattedMessage);
const mock = compiledMock.contracts["MockUSDC.sol"].MockUSDC;
const mockAbi = mock.abi;
const mockBytecode = `0x${mock.evm.bytecode.object}`;

let passed = 0;
let failed = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) { passed += 1; console.log(`  \u001b[32m✓\u001b[0m ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` -> ${detail}` : ""}`); console.log(`  \u001b[31m✗\u001b[0m ${name}${detail ? ` -> ${detail}` : ""}`); }
}
function section(name) { console.log(`\n\u001b[1m${name}\u001b[0m`); }
const key = (n) => hexToBytes(`0x${n.toString(16).padStart(64, "0")}`);
const address = (n) => Address.fromString(`0x${Buffer.from(privateToAddress(key(n))).toString("hex")}`);
const OWNER = address(0xa11ce), ALICE = address(0xb0b), BOB = address(0xca401), MALLORY = address(0xd1ce);
let TIME = 1_800_000_000;

async function main() {
  const vm = new VM({ common: new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Shanghai }) });
  for (const who of [OWNER, ALICE, BOB, MALLORY]) {
    await vm.stateManager.putAccount(who, new Account(0n, 10n ** 21n));
  }
  const blockAt = (timestamp) => Block.fromBlockData({ header: { number: 1n, timestamp: BigInt(timestamp), difficulty: 0n, gasLimit: 60_000_000n, baseFeePerGas: 0n } }, { common: vm.common, hardforkByTSBlockNum: false });
  async function call(caller, to, data, ts = TIME) {
    const block = blockAt(ts); vm.evm._block = block; vm.evm._tx = { gasPrice: 0n, origin: caller };
    const result = await vm.evm.runCall({ caller, to, data: hexToBytes(data), gasLimit: 30_000_000n, block });
    if (vm.stateManager._checkpointCount > 0) await vm.stateManager.commit();
    return result;
  }
  async function deploy(caller, bytecode, constructorData = "0x") {
    const block = blockAt(TIME); vm.evm._block = block; vm.evm._tx = { gasPrice: 0n, origin: caller };
    const result = await vm.evm.runCall({ block, message: new Message({ caller, gasLimit: 30_000_000n, value: 0n, depth: 0, data: hexToBytes(bytecode + constructorData.slice(2)) }) });
    if (vm.stateManager._checkpointCount > 0) await vm.stateManager.commit();
    if (!result.createdAddress) throw new Error(`deployment failed: ${result.execResult.exceptionError?.error}`);
    return result.createdAddress;
  }
  const decodeRevert = (result) => {
    try { return String(decodeErrorResult({ data: bytesToHex(result.execResult.returnValue), abi: [{ type: "error", name: "Error", inputs: [{ name: "reason", type: "string" }] }] }).args[0]); }
    catch { return bytesToHex(result.execResult.returnValue); }
  };
  const expectRevert = async (name, promise, needle) => { const result = await promise; const reason = result.execResult.exceptionError ? decodeRevert(result) : "no revert"; check(name, Boolean(result.execResult.exceptionError) && reason.includes(needle), reason); };
  const USDC = await deploy(OWNER, mockBytecode);
  const JAR = await deploy(OWNER, artifact.bytecode, encodeAbiParameters([{ type: "address" }], [USDC.toString()]));
  const tokenCall = (caller, fn, args = [], ts = TIME) => call(caller, USDC, encodeFunctionData({ abi: mockAbi, functionName: fn, args }), ts);
  const jarCall = (caller, fn, args = [], ts = TIME) => call(caller, JAR, encodeFunctionData({ abi: artifact.abi, functionName: fn, args }), ts);
  const read = (result, abi, fn) => decodeFunctionResult({ abi, functionName: fn, data: bytesToHex(result.execResult.returnValue) });
  const tokenRead = async (fn, args = []) => read(await tokenCall(OWNER, fn, args), mockAbi, fn);
  const jarRead = async (fn, args = []) => read(await jarCall(OWNER, fn, args), artifact.abi, fn);

  section("Deployment and constants");
  check("deployer owns SavingsJar", (await jarRead("owner")).toLowerCase() === OWNER.toString().toLowerCase());
  check("USDC has 6 decimals", await tokenRead("decimals") === 6);
  check("minimum lock is 24 hours", await jarRead("MIN_LOCK_DURATION") === 86_400n);
  check("maximum lock is 365 days", await jarRead("MAX_LOCK_DURATION") === 31_536_000n);
  check("maximum 10 active jars", await jarRead("MAX_JARS_PER_WALLET") === 10n);

  for (const who of [OWNER, ALICE, BOB, MALLORY]) {
    await tokenCall(OWNER, "mint", [who.toString(), 20_000_000_000n]);
    await tokenCall(who, "approve", [JAR.toString(), 20_000_000_000n]);
  }

  section("Targets and multi-jar creation");
  await expectRevert("target cannot equal initial deposit", jarCall(ALICE, "createJar", [1_000_000_000n, 7_776_000n, "Bad target", 1_000_000_000n]), "target must exceed");
  await expectRevert("target cannot be below initial deposit", jarCall(ALICE, "createJar", [1_000_000_000n, 7_776_000n, "Bad target", 999_000_000n]), "target must exceed");
  let result = await jarCall(ALICE, "createJar", [1_000_000_000n, 7_776_000n, "Vacation", 1_500_000_000n]);
  check("target jar creation succeeds", !result.execResult.exceptionError);
  result = await jarCall(ALICE, "createJar", [100_000_000n, 7_776_000n, "Time only", 0n]);
  check("zero-target jar remains supported", !result.execResult.exceptionError);
  let jars = await jarRead("getJars", [ALICE.toString()]);
  check("two simultaneous jars returned", jars.length === 2 && jars[0].isActive && jars[1].isActive);
  check("target stored on jar 0", jars[0].targetAmount === 1_500_000_000n);
  check("weighted deposit time initialized", jars[0].weightedDepositTime === BigInt(TIME));
  check("create returns correct active accounting", await jarRead("totalActiveDeposits") === 1_100_000_000n);
  check("creation history is recorded per wallet", await jarRead("getActivityCount", [ALICE.toString()]) === 2n);
  let aliceHistory = await jarRead("getRecentActivities", [ALICE.toString(), 100n]);
  check("creation history identifies jar and amount", aliceHistory[0].activityType === 0 && aliceHistory[0].jarId === 0n && aliceHistory[0].amount === 1_000_000_000n);

  await jarCall(BOB, "createJar", [1_000_000_000n, 7_776_000n, "Bob", 0n]);
  await jarCall(MALLORY, "createJar", [1_000_000_000n, 7_776_000n, "Mallory", 0n]);

  section("Penalty rewards and public contributions");
  TIME += 86_400;
  result = await jarCall(BOB, "breakJar", [0n]);
  check("traditional locked jar can break", !result.execResult.exceptionError);
  const alicePendingBefore = await jarRead("pendingReward", [ALICE.toString(), 0n]);
  check("Alice receives penalty-funded pending reward", alicePendingBefore > 0n);
  const ownerBeforeGift = await tokenRead("balanceOf", [ALICE.toString()]);
  result = await jarCall(MALLORY, "addToJar", [ALICE.toString(), 0n, 200_000_000n]);
  check("another wallet can contribute", !result.execResult.exceptionError);
  jars = await jarRead("getJars", [ALICE.toString()]);
  check("specific jar balance increased", jars[0].amount === 1_200_000_000n && jars[1].amount === 100_000_000n);
  check("gift does not transfer ownership funds", await tokenRead("balanceOf", [ALICE.toString()]) === ownerBeforeGift);
  check("new principal cannot claim historical rewards", await jarRead("pendingReward", [ALICE.toString(), 0n]) === alicePendingBefore);
  check("weighted timestamp moves forward after top-up", jars[0].weightedDepositTime > BigInt(TIME - 86_400) && jars[0].weightedDepositTime < BigInt(TIME));
  aliceHistory = await jarRead("getRecentActivities", [ALICE.toString(), 100n]);
  const malloryHistoryAfterGift = await jarRead("getRecentActivities", [MALLORY.toString(), 100n]);
  const received = aliceHistory[aliceHistory.length - 1];
  const sent = malloryHistoryAfterGift[malloryHistoryAfterGift.length - 1];
  check("recipient history records contributor wallet", received.activityType === 3 && received.actor.toLowerCase() === MALLORY.toString().toLowerCase() && received.amount === 200_000_000n);
  check("sender history records destination wallet", sent.activityType === 2 && sent.counterparty.toLowerCase() === ALICE.toString().toLowerCase());
  await expectRevert("invalid jar id rejected", jarCall(MALLORY, "addToJar", [ALICE.toString(), 9n, 1_000_000n]), "invalid jar id");
  await expectRevert("zero contribution rejected", jarCall(MALLORY, "addToJar", [ALICE.toString(), 0n, 0n]), "greater than 0");
  result = await jarCall(MALLORY, "addToJar", [ALICE.toString(), 0n, 300_000_000n]);
  check("contributions can reach target", !result.execResult.exceptionError && await jarRead("isTargetReached", [ALICE.toString(), 0n]));
  check("target makes jar withdrawable", await jarRead("canWithdraw", [ALICE.toString(), 0n]) === true);
  aliceHistory = await jarRead("getRecentActivities", [ALICE.toString(), 100n]);
  check("target completion is recorded", aliceHistory[aliceHistory.length - 1].activityType === 7);
  await expectRevert("target-complete jar cannot use emergency break", jarCall(ALICE, "breakJar", [0n]), "target reached");
  await expectRevert("contributor cannot withdraw owner's jar", jarCall(MALLORY, "withdrawJar", [0n]), "jar locked");

  section("Early target withdrawal and reward redistribution");
  const aliceBalanceBefore = await tokenRead("balanceOf", [ALICE.toString()]);
  const rewardPoolBefore = await jarRead("rewardPoolBalance");
  result = await jarCall(ALICE, "withdrawJar", [0n]);
  check("owner withdraws target jar before maturity", !result.execResult.exceptionError);
  check("owner receives principal only", await tokenRead("balanceOf", [ALICE.toString()]) - aliceBalanceBefore === 1_500_000_000n);
  check("early target withdrawal awards no points", await jarRead("points", [ALICE.toString()]) === 0n);
  check("reward pool bucket remains funded", await jarRead("rewardPoolBalance") === rewardPoolBefore);
  const malloryPending = await jarRead("pendingReward", [MALLORY.toString(), 0n]);
  check("forfeited pending reward redistributed", malloryPending > alicePendingBefore);
  jars = await jarRead("getJars", [ALICE.toString()]);
  check("only selected jar closed", !jars[0].isActive && jars[1].isActive);
  aliceHistory = await jarRead("getRecentActivities", [ALICE.toString(), 100n]);
  check("early target withdrawal appears in history", aliceHistory[aliceHistory.length - 1].activityType === 5);

  section("Mature incentive withdrawal and accounting");
  await jarCall(OWNER, "fundBonusPool", [1_000_000_000n]);
  TIME += 7_776_000;
  const malloryBalanceBefore = await tokenRead("balanceOf", [MALLORY.toString()]);
  const previewReward = await jarRead("pendingReward", [MALLORY.toString(), 0n]);
  const previewBonus = await jarRead("previewBonus", [MALLORY.toString(), 0n]);
  result = await jarCall(MALLORY, "withdrawJar", [0n]);
  check("mature withdrawal succeeds", !result.execResult.exceptionError);
  check("mature payout includes principal, reward and bonus", await tokenRead("balanceOf", [MALLORY.toString()]) - malloryBalanceBefore === 1_000_000_000n + previewReward + previewBonus);
  check("mature saver earns points", await jarRead("points", [MALLORY.toString()]) > 0n);
  const malloryFinalHistory = await jarRead("getRecentActivities", [MALLORY.toString(), 100n]);
  check("mature withdrawal appears in history", malloryFinalHistory[malloryFinalHistory.length - 1].activityType === 4);
  const summary = await jarRead("getAccountingSummary");
  const contractBalance = await tokenRead("balanceOf", [JAR.toString()]);
  const accounted = summary[1] + summary[2] + summary[3] + summary[4];
  check("accounting reports the token balance", summary[0] === contractBalance);
  check("accounting buckets equal contract balance", accounted === contractBalance, `${accounted} != ${contractBalance}`);
  check("total top-ups tracked", await jarRead("totalTopUps") === 500_000_000n);

  console.log(`\n\u001b[1m${passed} passed, ${failed} failed\u001b[0m`);
  if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
