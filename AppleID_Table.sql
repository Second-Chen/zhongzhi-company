-- Apple ID 申請記錄表
-- 用於記錄 Apple ID 註冊所需的資訊

CREATE TABLE AppleID_Applications (
    -- 主鍵
    ApplicationID INT IDENTITY(1,1) PRIMARY KEY,
    
    -- 基本資料
    FirstName NVARCHAR(100) NOT NULL,           -- 名字
    LastName NVARCHAR(100) NOT NULL,            -- 姓氏
    Email NVARCHAR(255) NOT NULL UNIQUE,        -- Apple ID (電子郵件)
    PasswordHash NVARCHAR(500) NOT NULL,        -- 密碼 (建議儲存哈希值)
    
    -- 個人資訊
    DateOfBirth DATE NOT NULL,                  -- 出生日期
    CountryCode CHAR(2) NOT NULL,               -- 國家/地區代碼 (TW, US, JP 等)
    CountryName NVARCHAR(100),                  -- 國家/地區名稱
    
    -- 電話資訊
    PhoneNumber NVARCHAR(20),                   -- 電話號碼 (含國碼)
    PhoneCountryCode NVARCHAR(5),               -- 電話國碼 (+886, +1 等)
    PhoneVerified BIT DEFAULT 0,                -- 電話是否已驗證
    
    -- 安全問題 (建議加密儲存)
    SecurityQuestion1 NVARCHAR(500),            -- 安全問題1
    SecurityAnswer1 NVARCHAR(500),              -- 安全答案1
    SecurityQuestion2 NVARCHAR(500),            -- 安全問題2
    SecurityAnswer2 NVARCHAR(500),              -- 安全答案2
    SecurityQuestion3 NVARCHAR(500),            -- 安全問題3
    SecurityAnswer3 NVARCHAR(500),              -- 安全答案3
    
    -- 付款資訊 (可選)
    PaymentMethod NVARCHAR(50),                 -- 付款方式 (Credit Card, PayPal, None)
    CardLastFourDigits CHAR(4),                 -- 卡片末四碼 (如適用)
    
    -- 裝置資訊
    DeviceType NVARCHAR(50),                    -- 裝置類型 (iPhone, iPad, Mac, PC)
    DeviceModel NVARCHAR(100),                  -- 裝置型號
    
    -- 申請狀態
    ApplicationStatus NVARCHAR(20) DEFAULT 'Pending', -- 申請狀態 (Pending, Approved, Rejected, Completed)
    AppleIDStatus NVARCHAR(20) DEFAULT 'Inactive',    -- Apple ID 狀態 (Active, Inactive, Suspended)
    
    -- 時間戳記
    CreatedAt DATETIME2 DEFAULT GETDATE(),      -- 建立時間
    UpdatedAt DATETIME2 DEFAULT GETDATE(),      -- 更新時間
    VerifiedAt DATETIME2,                       -- 驗證時間
    
    -- 備註
    Notes NVARCHAR(MAX),                        -- 備註
    
    -- 建立索引
    INDEX IX_Email (Email),
    INDEX IX_PhoneNumber (PhoneNumber),
    INDEX IX_ApplicationStatus (ApplicationStatus),
    INDEX IX_CreatedAt (CreatedAt)
);

-- 建立更新時間觸發器 (選用)
CREATE TRIGGER trg_UpdateAppleIDTimestamp
ON AppleID_Applications
AFTER UPDATE
AS
BEGIN
    UPDATE AppleID_Applications
    SET UpdatedAt = GETDATE()
    WHERE ApplicationID IN (SELECT DISTINCT ApplicationID FROM inserted);
END;
GO

-- ============================================
-- 使用說明
-- ============================================

-- 插入範例
/*
INSERT INTO AppleID_Applications (
    FirstName, LastName, Email, PasswordHash,
    DateOfBirth, CountryCode, CountryName,
    PhoneCountryCode, PhoneNumber,
    SecurityQuestion1, SecurityAnswer1,
    SecurityQuestion2, SecurityAnswer2,
    SecurityQuestion3, SecurityAnswer3,
    DeviceType, ApplicationStatus
)
VALUES (
    '小明', '王', 'wangxm@example.com', 'HASH_VALUE_HERE',
    '1990-01-15', 'TW', '台灣',
    '+886', '912345678',
    '您出生的城市是？', '台北',
    '您的第一隻寵物叫什麼名字？', '小白',
    '您最喜歡的電影是什麼？', '星際大戰',
    'iPhone', 'Pending'
);
*/

-- 查詢範例
-- SELECT * FROM AppleID_Applications WHERE ApplicationStatus = 'Pending';
