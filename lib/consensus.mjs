import { createHash } from "node:crypto";

export function verifyConsensus(round) {
  if (!round || typeof round !== "object") return false;

  const { agents, proposal, assents } = round;
  if (!Array.isArray(agents) || agents.length < 2 || agents.length > 8) return false;
  if (!proposal || typeof proposal !== "object") return false;
  if (typeof proposal.text !== "string" || typeof proposal.version !== "string") return false;
  if (!assents || typeof assents !== "object" || Array.isArray(assents)) return false;

  const seen = new Set();
  for (const id of agents) {
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) return false;
    seen.add(id);
  }

  const version = createHash("sha256").update(proposal.text, "utf8").digest("hex").slice(0, 16);
  if (version !== proposal.version) return false;

  for (const id of agents) {
    const assent = assents[id];
    if (!assent || typeof assent !== "object" || Array.isArray(assent)) return false;
    if (assent.vote !== "AGREE") return false;
    if (assent.version !== version) return false;
  }

  return true;
}

// argue 模式：除全员对同一版本 AGREE 外，还必须有独立裁判对同一版本给出 CONSENSUS，且已过强制交锋期。
export function verifyArgueConsensus(round) {
  if (!verifyConsensus(round)) return false;
  const v = round.verdict;
  if (!v || v.verdict !== "CONSENSUS" || v.version !== round.proposal.version) return false;
  if (typeof round.judge !== "string" || round.agents.includes(round.judge)) return false;
  if (!Array.isArray(v.evidence) || !v.evidence.some((e) => e && e.grounded === true)) return false;
  return Number.isInteger(round.minCycles) && round.cycle + 1 > round.minCycles;
}
