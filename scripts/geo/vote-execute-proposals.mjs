import { daoSpace } from "@geoprotocol/geo-sdk";
import { DaoSpaceAbi } from "@geoprotocol/geo-sdk/abis";

import { bytes16Hex, loadGeoEnv } from "./lib/env.mjs";
import { readJsonFile } from "./lib/manifest.mjs";
import { deriveCallerContext } from "./lib/publish.mjs";

const PROPOSALS_PATH = new URL("../../data/geo/proposals.json", import.meta.url);

function selectedProposals(ledger) {
  const requestedKeys = process.argv
    .slice(2)
    .filter((arg) => !arg.startsWith("--"));

  if (requestedKeys.length === 0 || requestedKeys.includes("all")) {
    return ledger.proposals;
  }

  const requested = new Set(requestedKeys);
  return ledger.proposals.filter((proposal) => requested.has(proposal.key));
}

async function requireReceipt(publicClient, hash, label) {
  const receipt = await publicClient.getTransactionReceipt({ hash });

  if (receipt.status !== "success") {
    throw new Error(`${label} transaction ${hash} did not succeed.`);
  }

  return receipt;
}

async function sendGovernanceTx({ wallet, publicClient, tx }) {
  const txHash = await wallet.sendTransaction({
    account: wallet.account,
    to: tx.to,
    data: tx.calldata,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  return {
    txHash,
    status: receipt.status,
  };
}

async function readProposalState({ publicClient, config, callerSpaceId, proposal }) {
  const [info, vote, supportReached, block] = await Promise.all([
    publicClient.readContract({
      address: config.targetSpaceAddress,
      abi: DaoSpaceAbi,
      functionName: "getLatestProposalInformation",
      args: [proposal.proposalId],
    }),
    publicClient.readContract({
      address: config.targetSpaceAddress,
      abi: DaoSpaceAbi,
      functionName: "getLatestProposalVote",
      args: [proposal.proposalId, bytes16Hex(callerSpaceId)],
    }),
    publicClient.readContract({
      address: config.targetSpaceAddress,
      abi: DaoSpaceAbi,
      functionName: "isSupportThresholdReached",
      args: [proposal.proposalId],
    }),
    publicClient.getBlock(),
  ]);

  const now = Number(block.timestamp);
  const startDate = Number(info[2].startDate);
  const lastDate = Number(info[2].lastDate);

  return {
    executed: Boolean(info[0]),
    vote: Number(vote),
    supportReached,
    votingOpen: now >= startDate && now <= lastDate,
    startDate,
    lastDate,
    secondsUntilClose: lastDate - now,
    tally: {
      yes: info[3].yes.toString(),
      no: info[3].no.toString(),
      abstain: info[3].abstain.toString(),
    },
  };
}

const config = loadGeoEnv({ requirePrivateKey: false });
const ledger = await readJsonFile(PROPOSALS_PATH);

if (ledger.targetSpace.id !== config.targetSpaceId) {
  throw new Error(
    `Ledger target ${ledger.targetSpace.id} does not match env target ${config.targetSpaceId}.`
  );
}

if (
  ledger.targetSpace.address.toLowerCase() !==
  config.targetSpaceAddress.toLowerCase()
) {
  throw new Error(
    `Ledger address ${ledger.targetSpace.address} does not match env address ${config.targetSpaceAddress}.`
  );
}

const proposals = selectedProposals(ledger);

if (proposals.length === 0) {
  throw new Error("No proposals selected.");
}

const summary = {
  ok: true,
  dryRun: config.dryRun,
  targetSpaceId: config.targetSpaceId,
  targetSpaceName: config.targetSpaceName,
  selected: proposals.map((proposal) => proposal.key),
  results: [],
};

if (config.dryRun) {
  for (const proposal of proposals) {
    summary.results.push({
      key: proposal.key,
      name: proposal.name,
      proposalId: proposal.proposalId,
      wouldVote: true,
      wouldExecute: true,
    });
  }

  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const caller = await deriveCallerContext(config.privateKey);

for (const proposal of proposals) {
  await requireReceipt(
    caller.publicClient,
    proposal.proposalTxHash,
    proposal.name
  );

  const before = await readProposalState({
    publicClient: caller.publicClient,
    config,
    callerSpaceId: caller.callerSpaceId,
    proposal,
  });

  let vote = {
    skipped: true,
    reason: before.executed
      ? "proposal-already-executed"
      : !before.votingOpen
        ? before.secondsUntilClose < 0
          ? "proposal-voting-period-closed"
          : "proposal-voting-period-not-started"
        : before.vote === 1
          ? "caller-already-voted-yes"
          : before.vote !== 0
            ? `caller-already-voted-option-${before.vote}`
            : null,
  };

  if (!before.executed && before.votingOpen && before.vote === 0) {
    const voteTx = daoSpace.voteProposal({
      proposalId: proposal.proposalId,
      authorSpaceId: bytes16Hex(caller.callerSpaceId),
      spaceId: bytes16Hex(config.targetSpaceId),
      vote: "YES",
    });

    try {
      vote = await sendGovernanceTx({
        wallet: caller.wallet,
        publicClient: caller.publicClient,
        tx: voteTx,
      });
    } catch (error) {
      const afterVoteError = await readProposalState({
        publicClient: caller.publicClient,
        config,
        callerSpaceId: caller.callerSpaceId,
        proposal,
      });

      if (afterVoteError.executed || afterVoteError.vote !== 0) {
        vote = {
          skipped: true,
          reason: "vote-became-unavailable-after-state-check",
          state: afterVoteError,
        };
      } else {
        throw error;
      }
    }
  }

  const afterVote = await readProposalState({
    publicClient: caller.publicClient,
    config,
    callerSpaceId: caller.callerSpaceId,
    proposal,
  });

  let execute = {
    skipped: true,
    reason: afterVote.executed
      ? "proposal-already-executed"
      : !afterVote.supportReached
        ? "support-threshold-not-reached"
        : null,
  };

  if (!afterVote.executed && afterVote.supportReached) {
    const executeTx = daoSpace.executeProposal({
      proposalId: proposal.proposalId,
      authorSpaceId: bytes16Hex(caller.callerSpaceId),
      spaceId: bytes16Hex(config.targetSpaceId),
    });

    try {
      execute = await sendGovernanceTx({
        wallet: caller.wallet,
        publicClient: caller.publicClient,
        tx: executeTx,
      });
    } catch (error) {
      const afterExecuteError = await readProposalState({
        publicClient: caller.publicClient,
        config,
        callerSpaceId: caller.callerSpaceId,
        proposal,
      });

      if (afterExecuteError.executed) {
        execute = {
          skipped: true,
          reason: "proposal-became-executed-after-state-check",
          state: afterExecuteError,
        };
      } else {
        throw error;
      }
    }
  }

  const afterExecute = await readProposalState({
    publicClient: caller.publicClient,
    config,
    callerSpaceId: caller.callerSpaceId,
    proposal,
  });

  summary.results.push({
    key: proposal.key,
    name: proposal.name,
    proposalId: proposal.proposalId,
    before,
    vote,
    execute,
    afterExecute,
  });
}

console.log(JSON.stringify(summary, null, 2));
