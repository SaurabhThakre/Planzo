export const readableError=(e:unknown)=>e instanceof Error?e.message:'That request could not be completed. Your input has been kept. Please retry.';
