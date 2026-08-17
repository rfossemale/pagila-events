// break-rental.ts
const postRentalBody = { filmId: 1, storeId: 1, customerId: 1, staffId: 1 };
const postRental = () =>
  fetch('http://localhost:3000/api/rentals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(postRentalBody),
  }).then((r) => r.json());
const [a,b] =  await Promise.all(Array.from({ length: 1 }, () => postRental()));
console.log(a, b);
// const postReturnBody = { rentalId: 1, inventoryId: 1 };
// const postReturn = () =>
//   fetch(`http://localhost:3000/api/rentals/16092/return`, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify(postReturnBody),
//   }).then((r) => r.json());
// // const [c,d] =  await Promise.all(Array.from({ length: 4 }, () => postReturn()));
// const result = await postReturn();
// console.log(result);

// console.log(c, d);

export { };
