// Build: csc.exe -nologo -platform:x64 -r:System.Web.Extensions.dll -out:tm1top.exe Tm1TopHelper.cs
// One request per process. Credentials enter only through stdin; never print them.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

class Tm1TopHelper
{
    const string DLL = "tm1api.dll";
    const uint ErrorType = 6, ArrayType = 7, BoolType = 4;
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };
    [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetDllDirectory(string path);
    [DllImport(DLL)] static extern IntPtr TM1SystemOpen();
    [DllImport(DLL)] static extern void TM1SystemClose(IntPtr h);
    [DllImport(DLL, CharSet = CharSet.Unicode)] static extern void TM1SystemAdminHostSetW(IntPtr h, string s);
    [DllImport(DLL, CharSet = CharSet.Unicode)] static extern void TM1SystemSetKeyFileW(IntPtr h, string s);
    [DllImport(DLL, CharSet = CharSet.Unicode)] static extern void TM1SystemSetKeyStashFileW(IntPtr h, string s);
    [DllImport(DLL)] static extern int TM1SystemServerNof(IntPtr h);
    [DllImport(DLL)] static extern IntPtr TM1SystemServerNameW(IntPtr h, uint i);
    [DllImport(DLL)] static extern IntPtr TM1SystemServerDisconnect(IntPtr pool, IntPtr conn);
    [DllImport(DLL)] static extern IntPtr TM1ValPoolCreate(IntPtr h);
    [DllImport(DLL)] static extern void TM1ValPoolDestroy(IntPtr pool);
    [DllImport(DLL, CharSet = CharSet.Unicode)] static extern IntPtr TM1ValStringW(IntPtr pool, string s, uint max);
    [DllImport(DLL, CharSet = CharSet.Unicode)] static extern IntPtr TM1ValStringEncryptW(IntPtr pool, string s, uint max);
    [DllImport(DLL)] static extern IntPtr TM1ValBool(IntPtr pool, ushort b);
    [DllImport(DLL)] static extern ushort TM1ValBoolGet(IntPtr h, IntPtr v);
    [DllImport(DLL)] static extern IntPtr TM1TopConnect(IntPtr pool, IntPtr server);
    [DllImport(DLL)] static extern IntPtr TM1TopGetCurrentState2(IntPtr pool, IntPtr conn, IntPtr verbose);
    [DllImport(DLL)] static extern IntPtr TM1TopVerifyAdmin(IntPtr pool, IntPtr conn, IntPtr user, IntPtr encryptedPassword);
    [DllImport(DLL)] static extern IntPtr TM1TopKillTiProcessString(IntPtr pool, IntPtr conn, IntPtr threadId);
    [DllImport(DLL)] static extern uint TM1ValType(IntPtr h, IntPtr v);
    // Exported but absent from TM1API.H. MaxSize is capacity, NOT row count.
    [DllImport(DLL)] static extern uint TM1ValArraySize(IntPtr h, IntPtr v);
    [DllImport(DLL)] static extern IntPtr TM1ValArrayGet(IntPtr h, IntPtr v, uint i);
    [DllImport(DLL)] static extern IntPtr TM1ValStringGetW(IntPtr h, IntPtr v);
    [DllImport(DLL)] static extern IntPtr TM1ValErrorStringW(IntPtr h, IntPtr v);
    [DllImport(DLL)] static extern uint TM1ValErrorCode(IntPtr h, IntPtr v);

    sealed class NativeError : Exception
    {
        public readonly uint Code;
        public NativeError(uint code, string message) : base(message) { Code = code; }
    }
    sealed class OperationError : Exception
    {
        public readonly string Reason;
        public OperationError(string reason) { Reason = reason; }
    }
    static bool keystorePresent = true;
    static string StringAt(IntPtr p) { return p == IntPtr.Zero ? "" : Marshal.PtrToStringUni(p); }
    static uint Check(IntPtr h, IntPtr value)
    {
        if (value == IntPtr.Zero) throw new InvalidOperationException("Native API returned a null value.");
        uint type = TM1ValType(h, value);
        if (type == ErrorType) throw new NativeError(TM1ValErrorCode(h, value), StringAt(TM1ValErrorStringW(h, value)));
        return type;
    }
    static string Field(Dictionary<string, object> input, string name)
    {
        object value;
        if (!input.TryGetValue(name, out value) || !(value is string)) throw new ArgumentException("Invalid request field: " + name);
        string text = (string)value;
        if (text.Length > 4096 || text.IndexOf('\0') >= 0) throw new ArgumentException("Invalid request field: " + name);
        return text;
    }
    static Dictionary<string, object> ReadInput()
    {
        var input = new StringBuilder();
        int c;
        while ((c = Console.In.Read()) != -1)
        {
            if (input.Length >= 65536) throw new ArgumentException("Request exceeds size limit.");
            input.Append((char)c);
        }
        return Json.Deserialize<Dictionary<string, object>>(input.ToString()) ?? new Dictionary<string, object>();
    }
    static object Run(string[] args)
    {
        if (args.Length < 3 || args.Length > 4) throw new ArgumentException("Expected bin64Dir, adminHost, serverName and optional operation.");
        string bin = Path.GetFullPath(args[0]), operation = args.Length == 4 ? args[3] : "getState";
        if (operation != "getState" && operation != "enumServers" && operation != "verifyAdmin" && operation != "kill") throw new ArgumentException("Unknown operation.");
        if (!File.Exists(Path.Combine(bin, "tm1api.dll"))) throw new FileNotFoundException("Required native API file is missing: tm1api.dll");
        // A copied bin64 directory often carries no ssl subdirectory, and an admin server without
        // SSL needs none. Use the keystore when it is there; report it only when the call then fails.
        string kdb = Path.Combine(bin, @"ssl\ibmtm1.kdb"), sth = Path.Combine(bin, @"ssl\ibmtm1.sth");
        keystorePresent = File.Exists(kdb) && File.Exists(sth);
        if (!SetDllDirectory(bin)) throw new InvalidOperationException("Could not configure the native DLL directory.");
        IntPtr h = IntPtr.Zero, pool = IntPtr.Zero, conn = IntPtr.Zero;
        try
        {
            h = TM1SystemOpen();
            if (h == IntPtr.Zero) throw new InvalidOperationException("Could not open the native API.");
            if (keystorePresent) { TM1SystemSetKeyFileW(h, kdb); TM1SystemSetKeyStashFileW(h, sth); }
            TM1SystemAdminHostSetW(h, args[1]);
            if (operation == "enumServers")
            {
                int count = TM1SystemServerNof(h);
                if (count < 0 || count > 100000) throw new InvalidOperationException("Invalid server count.");
                var servers = new List<string>();
                for (uint i = 1; i <= count; i++) servers.Add(StringAt(TM1SystemServerNameW(h, i)));
                return new { servers = servers };
            }
            pool = TM1ValPoolCreate(h);
            if (pool == IntPtr.Zero) throw new InvalidOperationException("Could not allocate the native value pool.");
            IntPtr candidate = TM1TopConnect(pool, TM1ValStringW(pool, args[2], 0));
            Check(h, candidate);
            conn = candidate;
            if (operation == "getState")
            {
                IntPtr state = TM1TopGetCurrentState2(pool, conn, TM1ValBool(pool, 1));
                if (Check(h, state) != ArrayType) throw new InvalidOperationException("Native thread state is not an array.");
                uint count = TM1ValArraySize(h, state);
                if (count > 100000) throw new InvalidOperationException("Invalid thread count.");
                var rows = new List<string>();
                for (uint i = 1; i <= count; i++)
                {
                    IntPtr row = TM1ValArrayGet(h, state, i);
                    uint type = Check(h, row);
                    if (type != 2 && type != 14) throw new InvalidOperationException("Native thread row is not a string.");
                    rows.Add(StringAt(TM1ValStringGetW(h, row)));
                }
                return new { rows = rows };
            }
            var input = ReadInput();
            string username = Field(input, "username"), password = Field(input, "password");
            IntPtr verified = TM1TopVerifyAdmin(pool, conn, TM1ValStringW(pool, username, 0), TM1ValStringEncryptW(pool, password, 0));
            bool allowed = Check(h, verified) == BoolType && TM1ValBoolGet(h, verified) != 0;
            if (operation == "verifyAdmin") return new { verified = allowed };
            // Authorization is local to THIS connection. Never reuse a prior process's result.
            if (!allowed) throw new OperationError("verify-failed");
            string threadId = Field(input, "threadId");
            if (threadId.Length == 0) throw new ArgumentException("Invalid thread ID.");
            foreach (char c in threadId) if (c < '0' || c > '9') throw new ArgumentException("Invalid thread ID.");
            IntPtr killed = TM1TopKillTiProcessString(pool, conn, TM1ValStringW(pool, threadId, 0));
            if (Check(h, killed) != BoolType || TM1ValBoolGet(h, killed) == 0) throw new OperationError("kill-rejected");
            return new { killed = true };
        }
        finally
        {
            // Keep the connection's owning pool alive until disconnect completes.
            try { if (conn != IntPtr.Zero) TM1SystemServerDisconnect(pool, conn); }
            finally
            {
                try { if (pool != IntPtr.Zero) TM1ValPoolDestroy(pool); }
                finally { if (h != IntPtr.Zero) TM1SystemClose(h); }
            }
        }
    }
    static int Main(string[] args)
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        try { Console.WriteLine(Json.Serialize(Run(args))); return 0; }
        catch (OperationError ex) { Console.WriteLine(Json.Serialize(new { error = "TM1 Top operation rejected.", reason = ex.Reason })); }
        catch (NativeError ex) { Console.WriteLine(Json.Serialize(new { error = "TM1 native API request failed.", code = ex.Code, reason = keystorePresent ? "native-api" : "keystore-missing" })); }
        catch (DllNotFoundException) { Console.WriteLine(Json.Serialize(new { error = "TM1 native DLL or a dependent runtime could not be loaded.", reason = "dll-load" })); }
        catch (EntryPointNotFoundException) { Console.WriteLine(Json.Serialize(new { error = "A required TM1 native API export is missing.", reason = "missing-export" })); }
        catch (BadImageFormatException) { Console.WriteLine(Json.Serialize(new { error = "TM1 native API requires compatible Windows x64 binaries.", reason = "architecture" })); }
        catch (Exception) { Console.WriteLine(Json.Serialize(new { error = "TM1 native helper request failed.", reason = "helper-request" })); }
        return 2;
    }
}
