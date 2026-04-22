import { createPublicClient, http } from "viem";
import {
  TESTNET_RPC_URL,
  daoSpace,
  getSmartAccountWalletClient,
  personalSpace,
} from "@geoprotocol/geo-sdk";
import { SpaceRegistryAbi } from "@geoprotocol/geo-sdk/abis";
import { TESTNET } from "@geoprotocol/geo-sdk/contracts";

import { bytes16Hex } from "./env.mjs";

export async function deriveCallerContext(privateKey) {
  if (!privateKey) {
    throw new Error("A GEO_PRIVATE_KEY is required to derive the caller space.");
  }

  const wallet = await getSmartAccountWalletClient({ privateKey });
  const smartAccountAddress = wallet.account.address;
  const hasPersonalSpace = await personalSpace.hasSpace({
    address: smartAccountAddress,
  });

  if (!hasPersonalSpace) {
    throw new Error(
      `No personal space found for smart account ${smartAccountAddress}. Create it in Geo first.`
    );
  }

  const publicClient = createPublicClient({
    transport: http(TESTNET_RPC_URL),
  });

  const callerSpaceIdHex = await publicClient.readContract({
    address: TESTNET.SPACE_REGISTRY_ADDRESS,
    abi: SpaceRegistryAbi,
    functionName: "addressToSpaceId",
    args: [smartAccountAddress],
  });

  const callerSpaceId = String(callerSpaceIdHex).slice(2, 34).toLowerCase();

  return {
    wallet,
    publicClient,
    smartAccountAddress,
    callerSpaceId,
    callerSpaceIdHex,
  };
}

export function summarizeOps(ops) {
  return ops.reduce((summary, op) => {
    summary[op.type] = (summary[op.type] ?? 0) + 1;
    return summary;
  }, {});
}

export async function finalizeProposal({
  config,
  proposalName,
  ops,
  touched,
}) {
  const summary = {
    ok: true,
    dryRun: config.dryRun,
    proposalName,
    targetSpaceId: config.targetSpaceId,
    targetSpaceName: config.targetSpaceName,
    opCount: ops.length,
    opTypes: summarizeOps(ops),
    touched,
  };

  if (config.dryRun) {
    return summary;
  }

  const caller = await deriveCallerContext(config.privateKey);
  const proposal = await daoSpace.proposeEdit({
    name: proposalName,
    ops,
    author: caller.callerSpaceId,
    daoSpaceAddress: config.targetSpaceAddress,
    callerSpaceId: bytes16Hex(caller.callerSpaceId),
    daoSpaceId: bytes16Hex(config.targetSpaceId),
    votingMode: "FAST",
    network: config.network,
  });

  const txHash = await caller.wallet.sendTransaction({
    account: caller.wallet.account,
    to: proposal.to,
    data: proposal.calldata,
  });

  const receipt = await caller.publicClient.waitForTransactionReceipt({
    hash: txHash,
  });

  return {
    ...summary,
    dryRun: false,
    smartAccountAddress: caller.smartAccountAddress,
    callerSpaceId: caller.callerSpaceId,
    editId: proposal.editId,
    proposalId: proposal.proposalId,
    cid: proposal.cid,
    txHash,
    receiptStatus: receipt.status,
  };
}
