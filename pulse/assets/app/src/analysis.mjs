export function summarizeMetric(rows, key = 'views') {
  const measured = rows.filter(p => Number.isFinite(p[key]) && p[key] >= 0);
  const ranked = [...measured].sort((a, b) => b[key] - a[key] || a.content_id.localeCompare(b.content_id));
  const values = measured.map(p => p[key]).sort((a, b) => a - b);
  const count = values.length;
  const total = count ? values.reduce((a, b) => a + b, 0) : null;
  const median = count ? (values[Math.floor((count - 1) / 2)] + values[Math.floor(count / 2)]) / 2 : null;
  return {
    posts: rows.length,
    measured: count,
    missing: rows.length - count,
    total,
    median,
    approximate: key === 'views' && measured.some(p => p.views_approximate),
    topOneShare: total > 0 ? ranked[0][key] / total : null,
    topFiveShare: total > 0 ? ranked.slice(0, 5).reduce((a, p) => a + p[key], 0) / total : null,
    leaders: ranked.slice(0, 5)
  };
}

export function filterPeriod(rows, {month = '', paid = '', topic = ''} = {}) {
  return rows.filter(p => (!month || (p.published_at || '').startsWith(month)) &&
    (!paid || p.is_paid === paid) && (!topic || p.candidate_line === topic));
}

export function monthlyCounts(rows, {end = '', limit = 12} = {}) {
  const counts = new Map();
  for (const row of rows) {
    const month = row.published_at?.slice(0, 7);
    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || (end && month > end)) continue;
    counts.set(month, (counts.get(month) || 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).slice(-limit);
}

export function formatCounts(rows) {
  const labels = {reel:'Reels', carrossel:'Carrosséis', imagem:'Imagens'};
  const counts = new Map(Object.keys(labels).map(key => [key, 0]));
  for (const row of rows) {
    const key = Object.hasOwn(labels, row.format) ? row.format : 'outro';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].map(([key, count]) => ({key, label:labels[key] || 'A conferir', count}));
}

export function filterInventory(rows, {query = '', topic = '', sort = 'date', paid = '', month = '', format = ''} = {}) {
  const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const search = fold(query);
  return filterPeriod(rows, {month, paid}).filter(row =>
    (!topic || (row.candidate_line || 'A conferir') === topic) && (!format || row.format === format) &&
    (!search || fold([row.title, row.caption, row.description, row.content_id].join(' ')).includes(search))
  ).sort((a,b) => {
    const order = sort === 'date' ? (b.published_at || '').localeCompare(a.published_at || '') :
      (Number.isFinite(b[sort]) ? b[sort] : -1) - (Number.isFinite(a[sort]) ? a[sort] : -1);
    return order || a.content_id.localeCompare(b.content_id);
  });
}
