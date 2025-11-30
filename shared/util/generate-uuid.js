function generateShortUuid(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    result += chars[randomIndex];
  }
  
  return result;
}

// Export the function for use as a module
module.exports = { generateShortUuid };

// If run directly, generate and print a UUID
if (require.main === module) {
  const args = process.argv.slice(2);
  const length = args.length > 0 ? parseInt(args[0], 10) : 12;
  
  if (isNaN(length) || length <= 0) {
    console.error('Error: Length must be a positive number');
    process.exit(1);
  }
  
  const uuid = generateShortUuid(length);
  console.log(uuid);
}

