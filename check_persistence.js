const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

const tables = ['users', 'habits', 'journals', 'vision_board', 'notes', 'todos'];

db.serialize(() => {
    tables.forEach(table => {
        db.get(`SELECT COUNT(*) as count FROM ${table}`, (err, row) => {
            if (err) console.error(`Error reading ${table}:`, err.message);
            else console.log(`${table}: ${row.count} records`);
        });
    });
});

setTimeout(() => db.close(), 1000);
