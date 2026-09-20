import * as XLSX from 'xlsx';

const wb = XLSX.utils.book_new();
const wsData = [];
for (let i = 0; i < 40; i++) wsData.push(new Array(7).fill(null));

wsData[2][5] = 'Monday, September 2, 2026';
wsData[8][0] = 'Report filtered by Branch = Siyonat Branch , date criteria: from 09/01/2026 to 09/02/2026 , Void State = Not void';
wsData[10] = ['Catagory', 'Sub Category', 'Article Code', 'Article Name', 'Quantity', 'Avg Amount', 'Total Amount'];

let currentRow = 11;

function addCategory(catName) {
  const row = new Array(7).fill(null);
  row[0] = catName;
  wsData[currentRow++] = row;
}

function addArticle(code, name, qty, avgAmount) {
  const row = new Array(7).fill(null);
  const total = Number((qty * avgAmount).toFixed(2));
  row[2] = code;
  row[3] = name;
  row[4] = qty;
  row[5] = avgAmount;
  row[6] = total;
  wsData[currentRow++] = row;
  return total;
}

function addCategorySubtotal(catName, totalQty, totalAmt) {
  const row = new Array(7).fill(null);
  row[3] = catName;
  row[4] = totalQty;
  row[6] = Number(totalAmt.toFixed(2));
  wsData[currentRow++] = row;
}

let grandTotal = 0;

addCategory('FOOD');
let foodTotal = 0, foodQty = 0;
let t = addArticle('P-00001', 'Yeajet Kitfo', 10, 1655.50); foodTotal += t; foodQty += 10;
t = addArticle('P-00020', 'Fillet Tibes', 15, 1324.22); foodTotal += t; foodQty += 15;
t = addArticle('P-00002', 'Gomen Besiga', 5, 800.00); foodTotal += t; foodQty += 5;
t = addArticle('P-00003', 'Mixed Tibs', 8, 1200.00); foodTotal += t; foodQty += 8;
addCategorySubtotal('FOOD', foodQty, foodTotal);
grandTotal += foodTotal;

addCategory('BEVERAGE');
let bevTotal = 0, bevQty = 0;
t = addArticle('P-00045', 'Ambo Water', 20, 124.24); bevTotal += t; bevQty += 20;
t = addArticle('P-00051', 'Small Water', 50, 99.38); bevTotal += t; bevQty += 50;
t = addArticle('P-00257', 'Mojito', 12, 1490.68); bevTotal += t; bevQty += 12;
addCategorySubtotal('BEVERAGE', bevQty, bevTotal);
grandTotal += bevTotal;

addCategory('CAFE MENU');
let cafeTotal = 0, cafeQty = 0;
t = addArticle('P-00054', 'Traditional Coffee', 30, 107.66); cafeTotal += t; cafeQty += 30;
t = addArticle('P-00056', 'Macchiato', 40, 165.63); cafeTotal += t; cafeQty += 40;
t = addArticle('P-00057', 'Tea', 25, 78.68); cafeTotal += t; cafeQty += 25;
addCategorySubtotal('CAFE MENU', cafeQty, cafeTotal);
grandTotal += cafeTotal;

currentRow++;
function addFooter(label, amount) {
  const row = new Array(7).fill(null);
  row[4] = label;
  row[5] = amount;
  wsData[currentRow++] = row;
}

addFooter('Sub Total', Number(grandTotal.toFixed(2)));
let addCharge = Number((grandTotal * 0.05).toFixed(2));
addFooter('Add. Charge', addCharge);
addFooter('Discount', 0);
let tax = Number(((grandTotal + addCharge) * 0.15).toFixed(2));
addFooter('Total Tax', tax);
addFooter('Grand Total', Number((grandTotal + addCharge + tax).toFixed(2)));

const ws = XLSX.utils.aoa_to_sheet(wsData);
XLSX.utils.book_append_sheet(wb, ws, 'Report');
XLSX.writeFile(wb, 'cnet_test_export_fixed.xlsx');
console.log('File cnet_test_export_fixed.xlsx generated!');
