using System;
using System.IO.Ports;
using System.Threading.Tasks;

namespace SerialPortExample
{
    /// <summary>
    /// COM 端口通信管理類
    /// </summary>
    public class SerialPortManager : IDisposable
    {
        private SerialPort _serialPort;
        private bool _isConnected;

        /// <summary>
        /// 連接狀態
        /// </summary>
        public bool IsConnected => _isConnected && _serialPort?.IsOpen == true;

        /// <summary>
        /// 收到資料時觸發的事件
        /// </summary>
        public event EventHandler<string> DataReceived;

        /// <summary>
        /// 連線到 COM Port
        /// </summary>
        /// <param name="portName">COM 埠名稱 (如 "COM3")</param>
        /// <param name="baudRate">鮑率 (如 9600)</param>
        /// <param name="parity">同位檢查</param>
        /// <param name="dataBits">資料位元</param>
        /// <param name="stopBits">停止位元</param>
        /// <returns>是否連線成功</returns>
        public bool Connect(
            string portName = "COM1",
            int baudRate = 9600,
            Parity parity = Parity.None,
            int dataBits = 8,
            StopBits stopBits = StopBits.One)
        {
            try
            {
                // 如果已連線，先斷開
                Disconnect();

                // 建立 SerialPort 實例
                _serialPort = new SerialPort
                {
                    PortName = portName,
                    BaudRate = baudRate,
                    Parity = parity,
                    DataBits = dataBits,
                    StopBits = stopBits,
                    ReadTimeout = 5000,      // 讀取超時 5 秒
                    WriteTimeout = 5000,     // 寫入超時 5 秒
                    DtrEnable = true,        // 啟用 DTR
                    RtsEnable = true         // 啟用 RTS
                };

                // 訂閱資料接收事件
                _serialPort.DataReceived += OnDataReceived;

                // 開啟端口
                _serialPort.Open();
                _isConnected = true;

                Console.WriteLine($"✅ 成功連線到 {portName}");
                return true;
            }
            catch (UnauthorizedAccessException ex)
            {
                Console.WriteLine($"❌ 存取被拒：{ex.Message}");
                return false;
            }
            catch (IOException ex)
            {
                Console.WriteLine($"❌ I/O 錯誤：{ex.Message}");
                return false;
            }
            catch (InvalidOperationException ex)
            {
                Console.WriteLine($"❌ 操作無效：{ex.Message}");
                return false;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ 連線失敗：{ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// 斷開 COM Port 連線
        /// </summary>
        public void Disconnect()
        {
            if (_serialPort != null)
            {
                try
                {
                    _serialPort.DataReceived -= OnDataReceived;
                    if (_serialPort.IsOpen)
                    {
                        _serialPort.Close();
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"⚠️ 斷開連線時發生錯誤：{ex.Message}");
                }
                finally
                {
                    _serialPort.Dispose();
                    _serialPort = null;
                    _isConnected = false;
                }
            }
        }

        /// <summary>
        /// 下指令到 COM Port
        /// </summary>
        /// <param name="command">指令內容</param>
        /// <param name="appendNewLine">是否在結尾加上換行符</param>
        /// <returns>是否發送成功</returns>
        public bool SendCommand(string command, bool appendNewLine = true)
        {
            if (!IsConnected)
            {
                Console.WriteLine("❌ 未連線到 COM Port");
                return false;
            }

            try
            {
                string fullCommand = appendNewLine ? command + "\r\n" : command;
                _serialPort.Write(fullCommand);
                Console.WriteLine($"📤 發送指令：{command}");
                return true;
            }
            catch (TimeoutException ex)
            {
                Console.WriteLine($"❌ 發送超時：{ex.Message}");
                return false;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ 發送失敗：{ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// 下指令並等待回應
        /// </summary>
        /// <param name="command">指令內容</param>
        /// <param name="timeoutMs">等待回應的超時時間(毫秒)</param>
        /// <returns>設備回應的字串</returns>
        public string SendCommandAndWaitResponse(string command, int timeoutMs = 2000)
        {
            if (!IsConnected)
            {
                Console.WriteLine("❌ 未連線到 COM Port");
                return null;
            }

            try
            {
                // 清除緩衝區
                _serialPort.DiscardInBuffer();
                _serialPort.DiscardOutBuffer();

                // 發送指令
                string fullCommand = command + "\r\n";
                _serialPort.Write(fullCommand);
                Console.WriteLine($"📤 發送指令：{command}");

                // 等待並讀取回應
                System.Threading.Thread.Sleep(100); // 給設備一點時間處理
                
                string response = "";
                DateTime startTime = DateTime.Now;

                while ((DateTime.Now - startTime).TotalMilliseconds < timeoutMs)
                {
                    if (_serialPort.BytesToRead > 0)
                    {
                        response += _serialPort.ReadExisting();
                        if (response.Contains("\n") || response.Contains("\r"))
                        {
                            break;
                        }
                    }
                    System.Threading.Thread.Sleep(10);
                }

                Console.WriteLine($"📥 收到回應：{response.Trim()}");
                return response.Trim();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ 發送/接收失敗：{ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// 非同步發送指令
        /// </summary>
        public async Task<bool> SendCommandAsync(string command, bool appendNewLine = true)
        {
            return await Task.Run(() => SendCommand(command, appendNewLine));
        }

        /// <summary>
        /// 資料接收事件處理
        /// </summary>
        private void OnDataReceived(object sender, SerialDataReceivedEventArgs e)
        {
            try
            {
                string data = _serialPort.ReadExisting();
                Console.WriteLine($"📥 收到資料：{data.Trim()}");
                DataReceived?.Invoke(this, data);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ 接收資料時發生錯誤：{ex.Message}");
            }
        }

        /// <summary>
        /// 取得所有可用的 COM 埠列表
        /// </summary>
        public static string[] GetAvailablePorts()
        {
            return SerialPort.GetPortNames();
        }

        /// <summary>
        /// 釋放資源
        /// </summary>
        public void Dispose()
        {
            Disconnect();
        }
    }

    // ============================================
    // 使用範例
    // ============================================
    class Program
    {
        static void Main(string[] args)
        {
            // 顯示可用的 COM 埠
            Console.WriteLine("可用的 COM 埠：");
            foreach (var port in SerialPortManager.GetAvailablePorts())
            {
                Console.WriteLine($"  - {port}");
            }

            // 建立 SerialPortManager 實例
            using (var serialManager = new SerialPortManager())
            {
                // 訂閱資料接收事件
                serialManager.DataReceived += (sender, data) =>
                {
                    Console.WriteLine($"[事件] 收到資料：{data}");
                };

                // 連線到 COM3，鮑率 9600
                if (serialManager.Connect(
                    portName: "COM3",
                    baudRate: 9600,
                    parity: Parity.None,
                    dataBits: 8,
                    stopBits: StopBits.One))
                {
                    Console.WriteLine("\n--- 開始發送指令 ---\n");

                    // 方式 1：只發送指令（不等待回應）
                    serialManager.SendCommand("Hello Device");

                    // 方式 2：發送指令並等待回應
                    string response = serialManager.SendCommandAndWaitResponse("STATUS", 3000);
                    Console.WriteLine($"回應結果：{response}");

                    // 方式 3：非同步發送
                    // await serialManager.SendCommandAsync("COMMAND");

                    Console.WriteLine("\n按任意鍵斷開連線...");
                    Console.ReadKey();
                }
            }

            Console.WriteLine("已斷開連線");
        }
    }
}
