export const SUB_TASK_PREAMBLE = `[SUB-TASK MODE] You are a coordinated sub-task inside Parallel Code. A coordinator agent dispatched you to complete specific work.

You have two sub-task MCP tools available via the parallel-code server:

- land_self — Happy-path finish line. Call this after committing your work and passing verification. The backend will merge your branch into the coordinator branch and clean up your task.
- signal_done — Legacy/manual-review finish line. Use this only if the coordinator explicitly asks to review and land your branch manually.

RULES:
1. Complete your assigned work fully before calling land_self. Before landing:
   - Commit all changes (git add -A && git commit) with a meaningful message.
   - Run the project's tests and type checker and fix any failures you introduced. \
land_self requires structured verification — do not call it if tests or typecheck are failing, blocked, or unknown.
2. Ask questions if requirements are unclear or if you are about to do something risky or destructive — the user can see your terminal and can respond.
3. When your work is done, call land_self with the checks you ran. Do NOT call signal_done after a successful land_self, ask "what would you like to do?", or offer merge/PR options. Do NOT use finishing-a-development-branch or similar workflow skills.

---
`;

/**
 * Line that follows the role name. It exists so the role reads as a standing
 * constraint rather than a label, and so a role that contradicts the assignment
 * surfaces as a question instead of being quietly dropped.
 */
const ROLE_GUIDANCE =
  'The coordinator assigned you this role for this task. Work within it. If the assignment below needs something the role rules out, say so rather than doing it silently.';

/**
 * Role block prepended ahead of SUB_TASK_PREAMBLE when the coordinator gave the
 * sub-task a role.
 *
 * The role is free text, not an enum: nothing here binds tool permissions, so a
 * fixed vocabulary would carry exactly the same (advisory) force while costing
 * the flexibility. Kept in this module because it is prompt text, and kept out
 * of `preamble.ts` because that path writes AGENTS.md / GEMINI.md / .agent.md
 * files into the worktree, where they show up in the task's diff.
 *
 * Returns '' when nothing usable was supplied, so callers can concatenate
 * unconditionally and a no-role task keeps byte-identical prompt composition.
 */
export function buildRolePreamble(role?: string, roleInstructions?: string): string {
  const name = role?.trim();
  const instructions = roleInstructions?.trim();
  if (!name && !instructions) return '';

  const lines = [name ? `[ROLE] ${name}` : '[ROLE] (unnamed — see the instructions below)'];
  lines.push(ROLE_GUIDANCE);
  if (instructions) lines.push('', instructions);
  return `${lines.join('\n')}\n\n---\n\n`;
}
