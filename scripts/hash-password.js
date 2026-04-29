// Run: node scripts/hash-password.js yourpassword
// Then paste the output hash into users.json
const bcrypt = require('bcryptjs');
const password = process.argv[2];
if (!password) { console.error('Usage: node scripts/hash-password.js <password>'); process.exit(1); }
bcrypt.hash(password, 12).then(hash => console.log(hash));
