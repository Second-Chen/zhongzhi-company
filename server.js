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

// Helper function to generate random discount code (English + numbers, max 8 chars)
function generateDiscountCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluded confusing chars like I, O, 0, 1
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Helper function to create referral discount code for new user
async function createReferralCode(userId, username) {
    const code = generateDiscountCode();
    const validUntil = new Date();
    validUntil.setFullYear(validUntil.getFullYear() + 1); // Valid for 1 year
    
    await pool.execute(
        `INSERT INTO discount_codes (code, discount_type, discount_value, commission, valid_until, applicable_products, is_active, created_by)
         VALUES (?, 'percentage', 5.00, 10.00, ?, 'all', 1, ?)`,
        [code, validUntil, userId]
    );
    
    // Get the inserted ID
    const [rows] = await pool.execute('SELECT LAST_INSERT_ID() as id');
    const discountCodeId = rows[0].id;
    
    // Update user with referral code ID
    await pool.execute('UPDATE users SET referral_code_id = ? WHERE user_id = ?', [discountCodeId, userId]);
    
    return code;
}

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

        // Update last login time
        await pool.execute(
            'UPDATE users SET last_login_at = NOW() WHERE user_id = ?',
            [user.user_id]
        );

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

        // Create referral discount code for new user
        const referralCode = await createReferralCode(result.insertId, username);

        res.json({
            success: true,
            message: '註冊成功',
            referralCode: referralCode
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

        console.log('LINE callback received:', {
            line_user_id,
            line_display_name,
            line_email,
            has_access_token: !!access_token
        });

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
            // Update existing user - save email to both email and line_email fields
            await pool.execute(
                `UPDATE users SET 
                    line_display_name = ?,
                    line_picture_url = ?,
                    line_email = ?,
                    email = COALESCE(NULLIF(email, ''), ?),
                    line_access_token = ?,
                    line_refresh_token = ?,
                    line_token_expires_at = ?,
                    login_method = 'line',
                    last_login_at = NOW()
                WHERE line_user_id = ?`,
                [line_display_name, line_picture_url, line_email, line_email, access_token, refresh_token, tokenExpiresAt, line_user_id]
            );

            res.json({
                success: true,
                message: '登入成功',
                user: {
                    id: existingUser[0].user_id,
                    username: existingUser[0].username,
                    email: line_email || existingUser[0].email,
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

            // Create referral discount code for new user
            const referralCode = await createReferralCode(result.insertId, username);

            res.json({
                success: true,
                message: '註冊並登入成功',
                user: {
                    id: result.insertId,
                    username,
                    email: line_email,
                    line_display_name
                },
                referralCode: referralCode
            });
        }

    } catch (error) {
        console.error('LINE callback error:', error);
        res.status(500).json({ message: '伺服器錯誤' });
    }
});

// Google Login callback endpoint
app.post('/api/google-callback', async (req, res) => {
    try {
        const { code } = req.body;

        if (!code) {
            return res.status(400).json({ success: false, message: '缺少授權碼' });
        }

        // Google OAuth credentials from environment variables
        const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
        const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
        
        if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
            return res.status(500).json({ success: false, message: 'Google OAuth 未設定' });
        }
        
        const GOOGLE_REDIRECT_URI = 'https://familyshare.online/google-callback.html';

        // Exchange code for tokens
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code: code,
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: GOOGLE_REDIRECT_URI,
                grant_type: 'authorization_code'
            })
        });

        const tokenData = await tokenResponse.json();

        console.log('Google token response:', tokenData);

        if (!tokenData.access_token) {
            console.error('Token exchange failed:', tokenData);
            return res.status(400).json({ success: false, message: '無法取得 access token: ' + (tokenData.error_description || tokenData.error || 'Unknown error') });
        }

        // Get user info from Google
        const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { 'Authorization': 'Bearer ' + tokenData.access_token }
        });

        const googleUser = await userInfoResponse.json();

        console.log('Google user info:', googleUser);

        if (!googleUser.id) {
            return res.status(400).json({ success: false, message: '無法取得用戶資料' });
        }

        // Calculate token expiration (default 1 hour for Google)
        const tokenExpiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000);

        // Check if user exists
        const [existingUser] = await pool.execute(
            'SELECT * FROM users WHERE google_user_id = ?',
            [googleUser.id]
        );

        if (existingUser.length > 0) {
            // Update existing user
            await pool.execute(
                `UPDATE users SET 
                    google_display_name = ?,
                    google_email = ?,
                    google_access_token = ?,
                    google_refresh_token = ?,
                    google_token_expires_at = ?,
                    login_method = 'google',
                    last_login_at = NOW()
                WHERE google_user_id = ?`,
                [googleUser.name || null, googleUser.email || null, tokenData.access_token, tokenData.refresh_token || null, tokenExpiresAt, googleUser.id]
            );

            res.json({
                success: true,
                message: '登入成功',
                user: {
                    id: existingUser[0].user_id,
                    username: existingUser[0].username,
                    google_display_name: googleUser.name,
                    google_email: googleUser.email,
                    picture: googleUser.picture
                }
            });
        } else {
            // Create new user
            const username = googleUser.name || 'google_user_' + googleUser.id.slice(0, 8);
            const defaultPassword = await bcrypt.hash(Math.random().toString(36).slice(-8), 10);

            const [result] = await pool.execute(
                `INSERT INTO users (username, password_hash, email, google_user_id, google_display_name, google_email, google_access_token, google_refresh_token, google_token_expires_at, login_method)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'google')`,
                [username, defaultPassword, googleUser.email || '', googleUser.id, googleUser.name || null, googleUser.email || null, tokenData.access_token, tokenData.refresh_token || null, tokenExpiresAt]
            );

            // Create referral discount code for new user
            const referralCode = await createReferralCode(result.insertId, username);

            res.json({
                success: true,
                message: '註冊並登入成功',
                user: {
                    id: result.insertId,
                    username: username,
                    google_display_name: googleUser.name,
                    google_email: googleUser.email,
                    picture: googleUser.picture
                },
                referralCode: referralCode
            });
        }

    } catch (error) {
        console.error('Google callback error:', error);
        res.status(500).json({ success: false, message: '伺服器錯誤: ' + error.message });
    }
});

// Config endpoint - public config
app.get('/api/config/google-client-id', (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    res.json({ clientId: clientId || null });
});

// KKID Login callback endpoint
app.post('/api/kkid-callback', async (req, res) => {
    try {
        const { code } = req.body;

        if (!code) {
            return res.status(400).json({ success: false, message: '缺少授權碼' });
        }

        // KKBOX OAuth credentials from environment variables
        const KKBOX_CLIENT_ID = process.env.KKBOX_CLIENT_ID;
        const KKBOX_CLIENT_SECRET = process.env.KKBOX_CLIENT_SECRET;
        
        if (!KKBOX_CLIENT_ID || !KKBOX_CLIENT_SECRET) {
            return res.status(500).json({ success: false, message: 'KKBOX OAuth 未設定' });
        }
        
        const KKBOX_REDIRECT_URI = 'https://familyshare.online/kkid-callback.html';

        // Exchange code for tokens - using correct KKBOX OAuth endpoint from official docs
        const tokenResponse = await fetch('https://account.kkbox.com/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                client_id: KKBOX_CLIENT_ID,
                client_secret: KKBOX_CLIENT_SECRET,
                redirect_uri: KKBOX_REDIRECT_URI
            })
        });

        const tokenData = await tokenResponse.json();

        console.log('KKBOX token response:', tokenData);

        if (!tokenData.access_token) {
            console.error('Token exchange failed:', tokenData);
            return res.status(400).json({ success: false, message: '無法取得 access token: ' + (tokenData.error_description || tokenData.error || 'Unknown error') });
        }

        // Get user info from KKBOX - using correct API host
        const userInfoResponse = await fetch('https://api.kkbox.com/v1.1/me', {
            headers: { 'Authorization': 'Bearer ' + tokenData.access_token }
        });

        const kkboxUser = await userInfoResponse.json();

        console.log('KKBOX user info:', kkboxUser);

        if (!kkboxUser.id) {
            return res.status(400).json({ success: false, message: '無法取得用戶資料' });
        }

        const kkid_user_id = kkboxUser.id;
        const display_name = kkboxUser.name;
        
        // Try to get email from id_token if available, otherwise from user info
        let email = kkboxUser.email;
        if (!email && tokenData.id_token) {
            try {
                // Decode id_token to get email claim
                const idTokenParts = tokenData.id_token.split('.');
                if (idTokenParts.length >= 2) {
                    const payload = JSON.parse(Buffer.from(idTokenParts[1], 'base64').toString());
                    console.log('KKBOX id_token payload:', payload);
                    if (payload.email) {
                        email = payload.email;
                    }
                }
            } catch (e) {
                console.log('Failed to parse KKBOX id_token:', e);
            }
        }

        console.log('KKBOX email collected:', email);

        // Calculate token expiration
        const tokenExpiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000);

        // Check if user exists
        const [existingUser] = await pool.execute(
            'SELECT * FROM users WHERE kkid_user_id = ?',
            [kkid_user_id]
        );

        if (existingUser.length > 0) {
            // Update existing user - save email to both kkid_email and email fields
            await pool.execute(
                `UPDATE users SET 
                    kkid_display_name = ?,
                    kkid_email = ?,
                    email = COALESCE(NULLIF(email, ''), ?),
                    login_method = 'kkid',
                    last_login_at = NOW()
                WHERE kkid_user_id = ?`,
                [display_name || null, email || null, email || null, kkid_user_id]
            );

            res.json({
                success: true,
                message: '登入成功',
                user: {
                    id: existingUser[0].user_id,
                    username: existingUser[0].username,
                    kkid_display_name: display_name,
                    kkid_email: email
                }
            });
        } else {
            // Create new user
            const username = (display_name || 'kkid_user_' + kkid_user_id.slice(0, 8)) + '_' + Math.random().toString(36).substring(2, 6);
            const defaultPassword = await bcrypt.hash(Math.random().toString(36).slice(-8), 10);

            const [result] = await pool.execute(
                `INSERT INTO users (username, password_hash, email, kkid_user_id, kkid_display_name, kkid_email, login_method)
                VALUES (?, ?, ?, ?, ?, ?, 'kkid')`,
                [username, defaultPassword, email || '', kkid_user_id, display_name || null, email || null]
            );

            // Create referral discount code for new user
            const referralCode = await createReferralCode(result.insertId, username);

            res.json({
                success: true,
                message: '註冊並登入成功',
                user: {
                    id: result.insertId,
                    username: username,
                    kkid_display_name: display_name,
                    kkid_email: email
                },
                referralCode: referralCode
            });
        }

    } catch (error) {
        console.error('KKID callback error:', error);
        res.status(500).json({ success: false, message: '伺服器錯誤: ' + error.message });
    }
});

// Config endpoint for KKBOX
app.get('/api/config/kkbox-client-id', (req, res) => {
    const clientId = process.env.KKBOX_CLIENT_ID;
    res.json({ clientId: clientId || null });
});

// Serve index.html for root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Validate coupon code endpoint
app.get('/api/coupon/validate', async (req, res) => {
    try {
        const { code, product } = req.query;

        if (!code) {
            return res.status(400).json({ valid: false, message: '請輸入折扣碼' });
        }

        // Query coupon from database
        const [rows] = await pool.execute(
            'SELECT * FROM discount_codes WHERE code = ?',
            [code.toUpperCase()]
        );

        if (rows.length === 0) {
            return res.json({ valid: false, message: '折扣碼不存在' });
        }

        const coupon = rows[0];

        // Check if coupon is active
        if (!coupon.is_active) {
            return res.json({ valid: false, message: '此折扣碼已停用' });
        }

        // Check if coupon has not expired
        const now = new Date();
        if (now < new Date(coupon.valid_from) || now > new Date(coupon.valid_until)) {
            return res.json({ valid: false, message: '此折扣碼已過期' });
        }

        // Check usage limit
        if (coupon.max_uses !== null && coupon.current_uses >= coupon.max_uses) {
            return res.json({ valid: false, message: '此折扣碼已達使用上限' });
        }

        // Check applicable products
        if (coupon.applicable_products !== 'all' && coupon.applicable_products !== product && product) {
            return res.json({ valid: false, message: '此折扣碼不適用於此產品' });
        }

        // Return valid coupon data
        res.json({
            valid: true,
            message: '折扣碼套用成功',
            coupon: {
                code: coupon.code,
                discount_type: coupon.discount_type,
                discount_value: parseFloat(coupon.discount_value),
                min_purchase_amount: parseFloat(coupon.min_purchase_amount)
            }
        });

    } catch (error) {
        console.error('Coupon validation error:', error);
        res.status(500).json({ valid: false, message: '伺服器錯誤' });
    }
});

// Increment coupon usage endpoint
app.post('/api/coupon/use', async (req, res) => {
    try {
        const { code } = req.body;

        if (!code) {
            return res.status(400).json({ success: false, message: '請輸入折扣碼' });
        }

        // Increment usage
        const [result] = await pool.execute(
            'UPDATE discount_codes SET current_uses = current_uses + 1 WHERE code = ?',
            [code.toUpperCase()]
        );

        if (result.affectedRows === 0) {
            return res.json({ success: false, message: '折扣碼不存在' });
        }

        res.json({ success: true, message: '使用次數已更新' });

    } catch (error) {
        console.error('Coupon usage error:', error);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

// Create order endpoint
app.post('/api/orders/create', async (req, res) => {
    try {
        const { user_id, product_type, plan_duration_months, sub_accounts, original_price, discount_code, discount_amount, final_price, payment_method, notes } = req.body;

        if (!product_type || !plan_duration_months || !original_price || !final_price) {
            return res.status(400).json({ success: false, message: '請填寫必要欄位' });
        }

        // Generate order ID
        const orderId = 'ORD' + Date.now() + Math.random().toString(36).substr(2, 4).toUpperCase();

        // Use user_id from request body (sent from frontend from localStorage)
        // If not provided, try to get from token
        let userId = user_id;
        if (!userId) {
            const authHeader = req.headers.authorization;
            if (authHeader) {
                try {
                    const token = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
                    const userIdFromToken = parseInt(token.split(':')[0]);
                    if (!isNaN(userIdFromToken)) {
                        userId = userIdFromToken;
                    }
                } catch (e) {
                    // Invalid token, continue without user
                }
            }
        }

        // If discount code is provided, get the commission and discount_id
        let commission = 0;
        let discountId = null;
        if (discount_code) {
            const [codeRows] = await pool.execute(
                'SELECT id, commission FROM discount_codes WHERE code = ?',
                [discount_code]
            );
            if (codeRows.length > 0) {
                commission = codeRows[0].commission || 0;
                discountId = codeRows[0].id || null;
            }
        }

        // Insert order
        const [result] = await pool.execute(
            `INSERT INTO orders (order_id, user_id, product_type, plan_duration_months, sub_accounts, original_price, discount_code, discount_amount, discount_id, commission, final_price, payment_method, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [orderId, userId, product_type, plan_duration_months, sub_accounts || 1, original_price, discount_code || null, discount_amount || 0, discountId, commission, final_price, payment_method || null, notes || null]
        );

        res.json({
            success: true,
            message: '訂單已建立',
            order_id: orderId,
            order: {
                id: result.insertId,
                order_id: orderId,
                product_type,
                final_price
            }
        });

    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

// Get orders endpoint (using token)
app.get('/api/orders', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ success: false, message: '請先登入' });
        }

        const token = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
        const userId = parseInt(token.split(':')[0]);

        if (isNaN(userId)) {
            return res.status(401).json({ success: false, message: '無效的登入資訊' });
        }

        const [rows] = await pool.execute(
            'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
            [userId]
        );

        res.json({
            success: true,
            orders: rows
        });

    } catch (error) {
        console.error('Get orders error:', error);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

// Get orders by user ID (using query param)
app.get('/api/orders/by-user', async (req, res) => {
    try {
        const { user_id } = req.query;

        if (!user_id) {
            return res.status(400).json({ success: false, message: '請提供用戶ID' });
        }

        const [rows] = await pool.execute(
            'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
            [user_id]
        );

        res.json({
            success: true,
            orders: rows
        });

    } catch (error) {
        console.error('Get orders error:', error);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

// Get discount codes by user ID
app.get('/api/discount-codes/by-user', async (req, res) => {
    try {
        const { user_id } = req.query;

        if (!user_id) {
            return res.status(400).json({ success: false, message: '請提供用戶ID' });
        }

        const [rows] = await pool.execute(
            'SELECT * FROM discount_codes WHERE created_by = ? ORDER BY created_at DESC',
            [user_id]
        );

        res.json({
            success: true,
            discount_codes: rows
        });

    } catch (error) {
        console.error('Get discount codes error:', error);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

// Email verification helper function
async function sendVerificationEmail(email, token) {
    const crypto = require('crypto');
    const { Resend } = require('resend');
    
    // Check Resend API key
    const resendApiKey = process.env.RESEND_API_KEY;
    
    console.log('Resend API Check:');
    console.log('- RESEND_API_KEY:', resendApiKey ? 'SET (' + resendApiKey.length + ' chars)' : 'NOT SET');
    
    if (!resendApiKey) {
        console.error('RESEND_API_KEY not configured');
        return { success: false, error: 'Resend API not configured' };
    }
    
    const resend = new Resend(resendApiKey);
    
    // Verify URL
    const verifyUrl = `https://familyshare.online/verify-email.html?token=${token}`;

    const mailOptions = {
        from: process.env.SMTP_FROM || '"家庭共享計畫" <noreply@familyshare.online>',
        to: email,
        subject: '【家庭共享計畫】Email 驗證信',
        html: `
            <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #0984e3;">家庭共享計畫</h1>
                </div>
                <div style="background: #f8f9fa; padding: 30px; border-radius: 10px;">
                    <h2 style="color: #2d3436;">Email 驗證</h2>
                    <p style="color: #636e72; line-height: 1.6;">
                        您好，感謝您註冊家庭共享計畫！<br><br>
                        請點擊以下連結進行 Email 驗證：
                    </p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${verifyUrl}" style="display: inline-block; padding: 15px 30px; background: #0984e3; color: white; text-decoration: none; border-radius: 25px; font-weight: bold;">
                            驗證 Email
                        </a>
                    </div>
                    <p style="color: #636e72; font-size: 14px;">
                        如果無法點擊連結，請複製以下網址到瀏覽器開啟：<br>
                        <span style="color: #0984e3; word-break: break-all;">${verifyUrl}</span>
                    </p>
                    <p style="color: #b2bec3; font-size: 12px; margin-top: 30px;">
                        此驗證連結將在 24 小時後失效。<br>
                        如果您沒有進行註冊，請忽略此郵件。
                    </p>
                </div>
            </div>
        `
    };

    try {
        console.log('Sending email via Resend to:', email);
        
        const { data, error } = await resend.emails.send({
            from: '家庭共享計畫 <noreply@familyshare.online>',
            to: email,
            subject: '【家庭共享計畫】Email 驗證信',
            html: mailOptions.html
        });
        
        if (error) {
            console.error('Resend error:', error);
            return { success: false, error: error.message };
        }
        
        console.log('Email sent successfully to:', email, '| ID:', data?.id);
        return true;
    } catch (error) {
        console.error('Email sending error:', error.message);
        return { success: false, error: error.message };
    }
}

// Send verification email endpoint
app.post('/api/send-verification-email', async (req, res) => {
    try {
        const { user_id } = req.body;

        if (!user_id) {
            return res.status(400).json({ success: false, message: '請提供用戶ID' });
        }

        // Get user email
        const [rows] = await pool.execute(
            'SELECT email FROM users WHERE user_id = ?',
            [user_id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: '用戶不存在' });
        }

        const email = rows[0].email;
        if (!email) {
            return res.status(400).json({ success: false, message: '此帳號沒有綁定 Email' });
        }

        // Generate verification token
        const crypto = require('crypto');
        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        // Save token to database
        await pool.execute(
            'UPDATE users SET email_verify_token = ?, email_verify_expires = ? WHERE user_id = ?',
            [token, expires, user_id]
        );

        // Send verification email
        const result = await sendVerificationEmail(email, token);

        if (result && result.success !== false) {
            res.json({ success: true, message: '驗證信已發送' });
        } else {
            res.status(500).json({ success: false, message: '發送驗證信失敗: ' + (result?.error || '未知錯誤') });
        }

    } catch (error) {
        console.error('Send verification email error:', error);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

// Verify email endpoint
app.get('/api/verify-email', async (req, res) => {
    try {
        const { token } = req.query;

        if (!token) {
            return res.status(400).json({ success: false, message: '缺少驗證碼' });
        }

        // Find user with this token
        const [rows] = await pool.execute(
            'SELECT user_id, email_verify_expires FROM users WHERE email_verify_token = ?',
            [token]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: '驗證碼無效' });
        }

        // Check if token expired
        if (new Date() > new Date(rows[0].email_verify_expires)) {
            return res.status(400).json({ success: false, message: '驗證碼已過期，請重新發送' });
        }

        // Mark email as verified
        await pool.execute(
            'UPDATE users SET email_verified = 1, email_verify_token = NULL, email_verify_expires = NULL WHERE user_id = ?',
            [rows[0].user_id]
        );

        res.json({ success: true, message: 'Email 驗證成功' });

    } catch (error) {
        console.error('Verify email error:', error);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Get user profile endpoint
app.get('/api/user/profile', async (req, res) => {
    try {
        const { user_id } = req.query;

        if (!user_id) {
            return res.status(400).json({ success: false, message: '缺少用戶ID' });
        }

        const [rows] = await pool.execute(
            'SELECT user_id, username, email, email_verified, login_method, created_at FROM users WHERE user_id = ?',
            [user_id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: '用戶不存在' });
        }

        const user = rows[0];
        
        // Format created_at
        const createdAt = user.created_at ? new Date(user.created_at).toLocaleString('zh-TW', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }) : null;

        res.json({
            success: true,
            user: {
                id: user.user_id,
                username: user.username,
                email: user.email,
                email_verified: user.email_verified === 1,
                login_method: user.login_method,
                created_at: createdAt
            }
        });

    } catch (error) {
        console.error('Get user profile error:', error);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});
