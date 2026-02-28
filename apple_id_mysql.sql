-- Apple ID 申請記錄表 (MySQL 版本)
-- 用於記錄 Apple ID 註冊所需的資訊

CREATE TABLE IF NOT EXISTS apple_id_applications (
    -- 主鍵
    application_id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- 基本資料
    first_name VARCHAR(100) NOT NULL COMMENT '名字',
    last_name VARCHAR(100) NOT NULL COMMENT '姓氏',
    email VARCHAR(255) NOT NULL COMMENT 'Apple ID (電子郵件)',
    password_hash VARCHAR(500) NOT NULL COMMENT '密碼哈希值',
    
    -- 個人資訊
    date_of_birth DATE NOT NULL COMMENT '出生日期',
    country_code CHAR(2) NOT NULL COMMENT '國家/地區代碼 (TW, US, JP 等)',
    country_name VARCHAR(100) COMMENT '國家/地區名稱',
    
    -- 電話資訊
    phone_number VARCHAR(20) COMMENT '電話號碼 (含國碼)',
    phone_country_code VARCHAR(5) COMMENT '電話國碼 (+886, +1 等)',
    phone_verified TINYINT(1) DEFAULT 0 COMMENT '電話是否已驗證 (0=否, 1=是)',
    
    -- 安全問題 (建議加密儲存)
    security_question1 VARCHAR(500) COMMENT '安全問題1',
    security_answer1 VARCHAR(500) COMMENT '安全答案1',
    security_question2 VARCHAR(500) COMMENT '安全問題2',
    security_answer2 VARCHAR(500) COMMENT '安全答案2',
    security_question3 VARCHAR(500) COMMENT '安全問題3',
    security_answer3 VARCHAR(500) COMMENT '安全答案3',
    
    -- 付款資訊 (可選)
    payment_method VARCHAR(50) COMMENT '付款方式 (Credit Card, PayPal, None)',
    card_last_four_digits CHAR(4) COMMENT '卡片末四碼 (如適用)',
    
    -- 裝置資訊
    device_type VARCHAR(50) COMMENT '裝置類型 (iPhone, iPad, Mac, PC)',
    device_model VARCHAR(100) COMMENT '裝置型號',
    
    -- 申請狀態
    application_status VARCHAR(20) DEFAULT 'Pending' COMMENT '申請狀態 (Pending, Approved, Rejected, Completed)',
    apple_id_status VARCHAR(20) DEFAULT 'Inactive' COMMENT 'Apple ID 狀態 (Active, Inactive, Suspended)',
    
    -- 時間戳記
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '建立時間',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新時間',
    verified_at TIMESTAMP NULL COMMENT '驗證時間',
    
    -- 備註
    notes TEXT COMMENT '備註',
    
    -- 唯一索引
    UNIQUE KEY uk_email (email),
    
    -- 一般索引
    KEY idx_phone_number (phone_number),
    KEY idx_application_status (application_status),
    KEY idx_created_at (created_at),
    KEY idx_country_code (country_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Apple ID 申請記錄表';

-- ============================================
-- 常用查詢範例
-- ============================================

-- 1. 插入新申請
/*
INSERT INTO apple_id_applications (
    first_name, last_name, email, password_hash,
    date_of_birth, country_code, country_name,
    phone_country_code, phone_number,
    security_question1, security_answer1,
    security_question2, security_answer2,
    security_question3, security_answer3,
    device_type, application_status
) VALUES (
    '小明', '王', 'wangxm@example.com', '$2y$10$...',
    '1990-01-15', 'TW', '台灣',
    '+886', '912345678',
    '您出生的城市是？', '台北',
    '您的第一隻寵物叫什麼名字？', '小白',
    '您最喜歡的電影是什麼？', '星際大戰',
    'iPhone', 'Pending'
);
*/

-- 2. 查詢待處理的申請
-- SELECT * FROM apple_id_applications WHERE application_status = 'Pending';

-- 3. 查詢特定 Email 的申請
-- SELECT * FROM apple_id_applications WHERE email = 'wangxm@example.com';

-- 4. 更新申請狀態
/*
UPDATE apple_id_applications 
SET application_status = 'Approved', apple_id_status = 'Active'
WHERE application_id = 1;
*/

-- 5. 查詢最近 30 天的申請
-- SELECT * FROM apple_id_applications WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY);

-- 6. 統計各狀態數量
/*
SELECT 
    application_status, 
    COUNT(*) as count 
FROM apple_id_applications 
GROUP BY application_status;
*/
