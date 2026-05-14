const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Database connection error:', err.message);
    else console.log('Connected to the SQLite database.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, task TEXT, completed BOOLEAN DEFAULT 0)`);
    
    // 1. Habits (Streaks & History)
    db.run(`CREATE TABLE IF NOT EXISTS habits (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, streak INTEGER DEFAULT 0, last_completed DATE
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS habit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, habit_id INTEGER, user_id INTEGER, date DATE, UNIQUE(habit_id, date)
    )`);

    // 2. Journals (With Photos)
    db.run(`CREATE TABLE IF NOT EXISTS journals (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, entry TEXT, image_path TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 3. Locked Notes
    db.run(`
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    password TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)
`);
    db.run(`ALTER TABLE notes ADD COLUMN timestamp DATETIME DEFAULT CURRENT_TIMESTAMP`, (err) => {
        // Column might already exist
    });
});

module.exports = db;