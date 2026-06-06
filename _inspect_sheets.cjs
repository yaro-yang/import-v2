const XLSX = require('xlsx');
const path = '/Users/yangzhen/Desktop/demos/多门店分Sheet出库单.xlsx';

const wb = XLSX.readFile(path);
console.log('Sheets:', wb.SheetNames);
console.log('Sheets count:', wb.SheetNames.length);

for (const sn of wb.SheetNames) {
  const ws = wb.Sheets[sn];
  console.log(`\n=== Sheet: ${sn} ===`);
  console.log('  !ref:', ws['!ref']);
  console.log('  !merges:', JSON.stringify(ws['!merges']?.slice(0, 8)));

  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
  console.log('  Total rows:', data.length);
  console.log('  Cols:', data[0]?.length);

  // First 15 rows
  console.log('\n  --- First 15 rows ---');
  data.slice(0, 15).forEach((row, i) => {
    console.log(`  [${i}] ${JSON.stringify(row).slice(0, 400)}`);
  });

  // Last 5 rows
  if (data.length > 20) {
    console.log('\n  --- Last 5 rows ---');
    data.slice(-5).forEach((row, i) => {
      console.log(`  [${data.length - 5 + i}] ${JSON.stringify(row).slice(0, 400)}`);
    });
  }
}
