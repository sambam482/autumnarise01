const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use(session({
    secret: 'super-secret-local-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 }
}));

// Serve static files from the "frontend" directory
app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

const requireAuth = (req, res, next) => req.session.userId ? next() : res.status(401).json({ error: 'Unauthorized' });

// --- AUTHENTICATION ---
app.post('/api/signup', async (req, res) => {
    const { username, password } = req.body;
    console.log(`Signup attempt for: ${username}`);
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hashedPassword], function(err) {
        if (err) {
            console.error('Signup DB Error:', err.message);
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ error: 'Username already exists' });
            }
            return res.status(500).json({ error: 'Database error' });
        }
        req.session.userId = this.lastID;
        req.session.save((err) => {
            if (err) {
                console.error('Signup Session Save Error:', err);
                return res.status(500).json({ error: 'Session save failed' });
            }
            console.log(`User ${username} created successfully with ID ${this.lastID}`);
            res.json({ success: true });
        });
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    console.log(`Login attempt for: ${username}`);
    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (err) {
            console.error('Login DB Error:', err.message);
            return res.status(500).json({ error: 'Database error' });
        }
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        req.session.userId = user.id;
        req.session.save((err) => {
            if (err) {
                console.error('Login Session Save Error:', err);
                return res.status(500).json({ error: 'Session save failed' });
            }
            console.log(`User ${username} logged in successfully`);
            res.json({ success: true });
        });
    });
});
app.get('/api/me', requireAuth, (req, res) => {
    db.get(`SELECT username FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'User not found' });
        res.json({ loggedIn: true, username: user.username });
    });
});
app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

// --- 1. HABITS & STREAKS ---
app.get('/api/habits', requireAuth, (req, res) => {
    db.all(`SELECT * FROM habits WHERE user_id = ?`, [req.session.userId], (err, rows) => res.json(rows || []));
});
app.post('/api/habits', requireAuth, (req, res) => {
    db.run(`INSERT INTO habits (user_id, name) VALUES (?, ?)`, [req.session.userId, req.body.name], () => res.json({ success: true }));
});
app.post('/api/habits/:id/checkin', requireAuth, (req, res) => {
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
    console.log(`Checkin attempt for habit ${req.params.id} by user ${req.session.userId} on ${today}`);
    db.get(`SELECT streak, last_completed FROM habits WHERE id = ? AND user_id = ?`, [req.params.id, req.session.userId], (err, habit) => {
        if (err) { console.error('DB Error in checkin:', err); return res.status(500).send(); }
        if (!habit) { console.warn(`Habit ${req.params.id} not found for user ${req.session.userId}`); return res.status(404).send(); }
        if (habit.last_completed === today) return res.json({ success: true, msg: "Already completed today" });
        
        let newStreak = 1;
        if (habit.last_completed) {
            const last = new Date(habit.last_completed);
            const current = new Date(today);
            const diffDays = Math.floor((current - last) / (1000 * 60 * 60 * 24));
            if (diffDays === 1) newStreak = habit.streak + 1; // Increment if consecutive
        }
        
        console.log(`Updating streak to ${newStreak} for habit ${req.params.id}`);
        db.serialize(() => {
            db.run(`UPDATE habits SET streak = ?, last_completed = ? WHERE id = ? AND user_id = ?`, [newStreak, today, req.params.id, req.session.userId]);
            db.run(`INSERT OR IGNORE INTO habit_logs (habit_id, user_id, date) VALUES (?, ?, ?)`, [req.params.id, req.session.userId, today], (err) => {
                if (err) console.error('Error inserting log:', err);
                res.json({ success: true, newStreak });
            });
        });
    });
});

app.post('/api/habits/:id/uncheck', requireAuth, (req, res) => {
    const today = new Date().toLocaleDateString('en-CA');
    console.log(`Uncheck attempt for habit ${req.params.id} by user ${req.session.userId} on ${today}`);
    db.get(`SELECT streak, last_completed FROM habits WHERE id = ? AND user_id = ?`, [req.params.id, req.session.userId], (err, habit) => {
        if (err) { console.error('DB Error in uncheck:', err); return res.status(500).send(); }
        if (!habit || habit.last_completed !== today) return res.json({ success: true, msg: "Not completed today" });

        let newStreak = Math.max(0, habit.streak - 1);
        
        db.get(`SELECT date FROM habit_logs WHERE habit_id = ? AND user_id = ? AND date < ? ORDER BY date DESC LIMIT 1`, [req.params.id, req.session.userId, today], (err, prevLog) => {
            const prevDate = prevLog ? prevLog.date : null;
            console.log(`Reverting streak to ${newStreak} and last_completed to ${prevDate} for habit ${req.params.id}`);
            
            db.serialize(() => {
                db.run(`UPDATE habits SET streak = ?, last_completed = ? WHERE id = ? AND user_id = ?`, [newStreak, prevDate, req.params.id, req.session.userId]);
                db.run(`DELETE FROM habit_logs WHERE habit_id = ? AND user_id = ? AND date = ?`, [req.params.id, req.session.userId, today], (err) => {
                    if (err) console.error('Error deleting log:', err);
                    res.json({ success: true, newStreak });
                });
            });
        });
    });
});

app.get('/api/habits/:id/logs', requireAuth, (req, res) => {
    db.all(`SELECT date FROM habit_logs WHERE habit_id = ? AND user_id = ? ORDER BY date DESC`, [req.params.id, req.session.userId], (err, rows) => {
        res.json(rows || []);
    });
});

app.delete('/api/habits/:id', requireAuth, (req, res) => {
    db.serialize(() => {
        db.run(`DELETE FROM habit_logs WHERE habit_id = ? AND user_id = ?`, [req.params.id, req.session.userId]);
        db.run(`DELETE FROM habits WHERE id = ? AND user_id = ?`, [req.params.id, req.session.userId], () => res.json({ success: true }));
    });
});

// --- 2. JOURNALS ---
app.get('/api/journals', requireAuth, (req, res) => {
    db.all(`SELECT * FROM journals WHERE user_id = ? ORDER BY timestamp DESC`, [req.session.userId], (err, rows) => res.json(rows || []));
});
app.post('/api/journals', requireAuth, (req, res) => {
    db.run(`INSERT INTO journals (user_id, entry) VALUES (?, ?)`, [req.session.userId, req.body.entry], () => res.json({ success: true }));
});
app.delete('/api/journals/:id', requireAuth, (req, res) => {
    db.run(`DELETE FROM journals WHERE id = ? AND user_id = ?`, [req.params.id, req.session.userId], () => res.json({ success: true }));
});

// --- 3. LOCKED NOTES ---
app.get('/api/notes', requireAuth, (req, res) => {
    db.all(`SELECT id, title, timestamp FROM notes WHERE user_id = ? ORDER BY timestamp DESC`, [req.session.userId], (err, rows) => res.json(rows || []));
});
app.post('/api/notes', requireAuth, async (req, res) => {
    try {
        const { title, content, password } = req.body;

        if (!title || !content || !password) {
            return res.status(400).json({ error: 'All note fields are required' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        db.run(
            `INSERT INTO notes (user_id, title, content, password) VALUES (?, ?, ?, ?)`,
            [req.session.userId, title, content, hashedPassword],
            function(err) {
                if (err) {
                    console.error('Error saving note:', err.message);
                    return res.status(500).json({ error: 'Failed to save note' });
                }

                res.json({
                    success: true,
                    noteId: this.lastID
                });
            }
        );
    } catch (err) {
        console.error('Unexpected note save error:', err);
        res.status(500).json({ error: 'Server error while saving note' });
    }
});
app.delete('/api/notes/:id', requireAuth, (req, res) => {
    db.run(`DELETE FROM notes WHERE id = ? AND user_id = ?`, [req.params.id, req.session.userId], () => res.json({ success: true }));
});
app.post('/api/notes/:id/unlock', requireAuth, (req, res) => {
    db.get(`SELECT content, password FROM notes WHERE id = ? AND user_id = ?`, [req.params.id, req.session.userId], async (err, note) => {
        if (!note || !(await bcrypt.compare(req.body.password, note.password))) return res.status(401).json({ error: 'Incorrect password' });
        res.json({ success: true, content: note.content });
    });
});

// --- 5. TODOS ---
app.get('/api/todos', requireAuth, (req, res) => {
    db.all(`SELECT * FROM todos WHERE user_id = ?`, [req.session.userId], (err, rows) => res.json(rows || []));
});
app.post('/api/todos', requireAuth, (req, res) => {
    db.run(`INSERT INTO todos (user_id, task) VALUES (?, ?)`, [req.session.userId, req.body.task], () => res.json({ success: true }));
});
app.put('/api/todos/:id', requireAuth, (req, res) => {
    db.run(`UPDATE todos SET completed = NOT completed WHERE id = ? AND user_id = ?`, [req.params.id, req.session.userId], () => res.json({ success: true }));
});
app.delete('/api/todos/:id', requireAuth, (req, res) => {
    db.run(`DELETE FROM todos WHERE id = ? AND user_id = ?`, [req.params.id, req.session.userId], () => res.json({ success: true }));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));