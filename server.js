const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Serve static files
app.use(express.static(__dirname));

// Database configuration
const dbConfig = {
    host: process.env.DB_HOST || '43.163.195.190',
    port: process.env.DB_PORT || 31954,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '7K2UrBwFa8W91k4LMql30mNhi6z5bpuT',
    database: process.env.DB_NAME || 'zeabur'
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Login endpoint
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: '請輸入帳號和密碼' });
        }

        // Query user from database
        const [rows] = await pool.execute(
            'SELECT * FROM users WHERE username = ?',
            [username]
        );

        if (rows.length === 0) {
            return res.status(401).json({ message: '帳號或密碼錯誤' });
        }

        const user = rows[0];

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);

        if (!isValidPassword) {
            return res.status(401).json({ message: '帳號或密碼錯誤' });
        }

        // Generate simple token (in production, use JWT)
        const token = Buffer.from(`${user.user_id}:${username}`).toString('base64');

        res.json({
            success: true,
            token,
            message: '登入成功',
            user: {
                id: user.user_id,
                username: user.username,
                email: user.email
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: '伺服器錯誤' });
    }
});

// Register endpoint (optional)
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, email } = req.body;

        if (!username || !password || !email) {
            return res.status(400).json({ message: '請填寫所有欄位' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user
        const [result] = await pool.execute(
            'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
            [username, hashedPassword, email]
        );

        res.json({
            success: true,
            message: '註冊成功'
        });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: '帳號已存在' });
        }
        console.error('Register error:', error);
        res.status(500).json({ message: '伺服器錯誤' });
    }
});

// Serve index.html for root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
