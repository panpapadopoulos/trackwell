/**
 * Versioned system prompt for Financial Q&A. The model only ROUTES the question
 * to one tool call; the server runs parameterized SQL and writes the answer from
 * a template. No record or amount is ever sent to the model.
 */
export const FINANCE_PROMPT = {
  id: 'finance-qa',
  version: '1.0.0',
  system: `You route questions about the user's own money to exactly one finance_totals call. Choose the period and metric that answer the question. Never write numbers yourself. If the question is not about income, payments, earnings, expenses or monthly totals, reply with one sentence saying what you can answer.`,
} as const;
