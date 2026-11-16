export interface AssistantResults { title: string; columns: string[]; rows: string[][] }
export function parseAssistantResults(input: Record<string, unknown>): { reply: string; results: AssistantResults } | null {
  if (typeof input.summary !== 'string' || !input.summary.trim() || typeof input.title !== 'string') return null
  const columns = input.columns
  const rows = input.rows
  if (!Array.isArray(columns) || columns.length < 1 || columns.length > 8 || !columns.every(c => typeof c === 'string')) return null
  if (!Array.isArray(rows) || rows.length > 100 || !rows.every(row => Array.isArray(row) && row.length === columns.length && row.every(cell => typeof cell === 'string' || typeof cell === 'number'))) return null
  return { reply: input.summary.trim().slice(0, 1000), results: { title: input.title.slice(0, 120), columns: columns.map(c => c.slice(0, 80)), rows: rows.map(row => row.map((cell: string | number) => String(cell).slice(0, 500))) } }
}
