const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Force HTTPS redirect (if behind proxy)
// Note: Zeabur handles SSL termination, so this may not be needed

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

// LINE Login callback endpoint
app.post('/api/line-callback', async (req, res) => {
    try {
        const { line_user_id, line_display_name, line_picture_url, line_email, access_token, refresh_token, expires_in } = req.body;

        if (!line_user_id) {
            return res.status(400).json({ message: '缺少 LINE 用戶資料' });
        }

        // Calculate token expiration
        const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

        // Check if user exists
        const [existingUser] = await pool.execute(
            'SELECT * FROM users WHERE line_user_id = ?',
            [line_user_id]
        );

        if (existingUser.length > 0) {
            // Update existing user
            await pool.execute(
                `UPDATE users SET 
                    line_display_name = ?,
                    line_picture_url = ?,
                    line_email = ?,
                    line_access_token = ?,
                    line_refresh_token = ?,
                    line_token_expires_at = ?,
                    login_method = 'line',
                    last_login_at = NOW()
                WHERE line_user_id = ?`,
                [line_display_name, line_picture_url, line_email, access_token, refresh_token, tokenExpiresAt, line_user_id]
            );

            res.json({
                success: true,
                message: '登入成功',
                user: {
                    id: existingUser[0].user_id,
                    username: existingUser[0].username,
                    line_display_name
                }
            });
        } else {
            // Create new user
            const username = line_display_name || 'line_user_' + line_user_id.slice(0, 8);
            const defaultPassword = await bcrypt.hash(Math.random().toString(36).slice(-8), 10);

            const [result] = await pool.execute(
                `INSERT INTO users (username, password_hash, email, line_user_id, line_display_name, line_picture_url, line_email, line_access_token, line_refresh_token, line_token_expires_at, login_method)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'line')`,
                [username, defaultPassword, line_email || '', line_user_id, line_display_name, line_picture_url, line_email, access_token, refresh_token, tokenExpiresAt]
            );

            res.json({
                success: true,
                message: '註冊並登入成功',
                user: {
                    id: result.insertId,
                    username,
                    line_display_name
                }
            });
        }

    } catch (error) {
        console.error('LINE callback error:', error);
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
