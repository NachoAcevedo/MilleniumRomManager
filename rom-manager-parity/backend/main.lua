local millennium = require("millennium")
local ffi = require("ffi")
ffi.cdef[[
typedef struct {
    uint32_t cb;
    char *reserved, *desktop, *title;
    uint32_t x, y, width, height, columns, rows, fill, flags;
    uint16_t show, reservedSize;
    uint8_t *reservedData;
    void *input, *output, *error;
} SrmStartupInfo;
typedef struct {
    void *process, *thread;
    uint32_t processId, threadId;
} SrmProcessInfo;
int __stdcall CreateProcessA(const char *, char *, void *, void *, int,
    uint32_t, void *, const char *, SrmStartupInfo *, SrmProcessInfo *);
int __stdcall CloseHandle(void *);
]]
local kernel = ffi.load("kernel32")

local function start_without_console(command)
    local startup = ffi.new("SrmStartupInfo")
    startup.cb = ffi.sizeof(startup)
    local process = ffi.new("SrmProcessInfo")
    local buffer = ffi.new("char[?]", #command + 1)
    ffi.copy(buffer, command)
    local CREATE_NO_WINDOW = 0x08000000
    if kernel.CreateProcessA(nil, buffer, nil, nil, 0, CREATE_NO_WINDOW,
        nil, millennium.steam_path() .. [[\millennium\plugins\rom-manager-parity]], startup, process) == 0 then
        return false
    end
    kernel.CloseHandle(process.thread)
    kernel.CloseHandle(process.process)
    return true
end


local launch_status = assert(os.getenv("APPDATA")) .. [[\MillenniumRomManager\userData\window-launch-status.txt]]

function ImporterWindowState()
    local path = launch_status:gsub("window%-launch%-status%.txt$", "window-state.json")
    local file = io.open(path, "rb")
    if not file then return "{}" end
    local data = file:read("*a")
    file:close()
    return data
end

function ImporterLaunchStatus()
    local file = io.open(launch_status, "rb")
    if not file then return "pending" end
    local status = file:read("*a")
    file:close()
    return status
end

function OpenRomManager()
    os.remove(launch_status)
    local file = io.open(millennium.steam_path() .. [[\millennium\plugins\rom-manager-parity\backend\launch.b64]], "rb")
    if not file then return "Launcher files are missing." end
    local command = file:read("*a")
    file:close()
    if not command:match("^[A-Za-z0-9+/=]+$") then return "Invalid launcher files." end
    if start_without_console([[powershell.exe -NoProfile -EncodedCommand ]] .. command) then return "started" end
    return "Windows no pudo iniciar el importador."
end

return { on_load = function() millennium.ready() end }