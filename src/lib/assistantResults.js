// Normalize older saved tables as well as new assistant results.
export function splitAssistantRows(results) {
  const rows = results?.rows || [];
  const total = row => /^(grand\s+)?total$/i.test(String(row[0]).trim());
  const completedColumn = results?.columns?.findIndex(column => /completed.*(loads|deliveries)|(loads|deliveries).*completed/i.test(column)) ?? -1;
  return {
    rows: rows.filter(row => !total(row) && !(completedColumn >= 0 && /^0(?:\.0+)?(?:\s+(?:loads?|deliveries))?$/i.test(String(row[completedColumn]).trim()))),
    totals: rows.filter(total),
  };
}
