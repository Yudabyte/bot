const RUPIAH_UNITS = [
  [1_000_000_000_000_000, 'kuadriliun'],
  [1_000_000_000_000, 'triliun'],
  [1_000_000_000, 'miliar'],
  [1_000_000, 'juta'],
  [1_000, 'ribu'],
];

function formatRupiah(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error('Jumlah Rupiah harus berupa bilangan bulat non-negatif yang aman.');
  }

  let unitIndex = RUPIAH_UNITS.findIndex(([threshold]) => amount >= threshold);
  if (unitIndex < 0) return `Rp. ${amount.toLocaleString('id-ID')}`;

  while (unitIndex > 0 && Math.round((amount / RUPIAH_UNITS[unitIndex][0]) * 100) / 100 >= 1000) unitIndex -= 1;
  const [threshold, label] = RUPIAH_UNITS[unitIndex];
  const scaled = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(amount / threshold);
  return `Rp. ${scaled} ${label}`;
}

module.exports = { formatRupiah };
