// Test silo rotation calculation
const silos = [
  'Advanced CNC Machining Strategy',
  'Die Casting & Metal Casting',
  'Sheet Metal & Fabrication',
  'Rapid Tooling & Injection Molding',
  'Material Science & Surface Engineering'
];

console.log('Testing silo rotation:');
for(let day = 1; day <= 10; day++) {
  const index = (day - 1) % 5;
  console.log(`Day ${day}: index ${index} = ${silos[index]}`);
}

// Test today (assuming it's around day 20 of 2025)
const testDate = new Date('2025-01-20');
const startOfYear = new Date(testDate.getFullYear(), 0, 1);
const dayOfYear = Math.floor((testDate.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)) + 1;
const siloIndex = (dayOfYear - 1) % silos.length;
console.log(`\nFor date 2025-01-20:`);
console.log(`Day of year: ${dayOfYear}`);
console.log(`Silo index: ${siloIndex}`);
console.log(`Today's silo: ${silos[siloIndex]}`);



