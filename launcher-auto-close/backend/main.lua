local millennium = require("millennium")
local ffi = require("ffi")
local json = require("json")

ffi.cdef[[
typedef struct {
    uint32_t size, usage, pid;
    uintptr_t heap;
    uint32_t module, threads, parent;
    int32_t priority;
    uint32_t flags;
    uint16_t exe[260];
} LauncherProcessEntry;
void * __stdcall CreateToolhelp32Snapshot(uint32_t flags, uint32_t pid);
int __stdcall Process32FirstW(void *snapshot, LauncherProcessEntry *entry);
int __stdcall Process32NextW(void *snapshot, LauncherProcessEntry *entry);
void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid);
int __stdcall CloseHandle(void *handle);
int __stdcall TerminateProcess(void *process, uint32_t exitCode);
int __stdcall QueryFullProcessImageNameW(void *process, uint32_t flags, uint16_t *path, uint32_t *size);
int __stdcall MultiByteToWideChar(uint32_t codePage, uint32_t flags, const char *text, int length, uint16_t *wide, int size);
int __stdcall WideCharToMultiByte(uint32_t codePage, uint32_t flags, const uint16_t *wide, int length, char *text, int size, const char *fallback, int *used);
int __stdcall CompareStringOrdinal(const uint16_t *one, int sizeOne, const uint16_t *two, int sizeTwo, int ignoreCase);
int __stdcall EnumWindows(int (__stdcall *callback)(void *, intptr_t), intptr_t data);
uint32_t __stdcall GetWindowThreadProcessId(void *window, uint32_t *pid);
int __stdcall IsWindowVisible(void *window);
int __stdcall PostMessageW(void *window, uint32_t message, uintptr_t wparam, intptr_t lparam);
]]
local kernel = ffi.load("kernel32")
local user = ffi.load("user32")
local invalid_handle = ffi.cast("void *", -1)

function LauncherEpicInstall(payload)
    local app = json.decode(payload).app
    local base = os.getenv("ProgramData")
    if type(app) ~= "string" or not base then return "{}" end
    local file = io.open(base .. [[\Epic\UnrealEngineLauncher\LauncherInstalled.dat]], "rb")
    if not file then return "{}" end
    local contents = file:read("*a")
    file:close()
    local ok, installed = pcall(json.decode, contents)
    if not ok or type(installed) ~= "table" then return "{}" end
    for _, game in ipairs(installed.InstallationList or {}) do
        local folder = game.InstallLocation
        if game.AppName == app and type(folder) == "string" and folder:match("^%a:[/\\].+") then
            folder = folder:gsub("/", "\\"):gsub("\\+$", ""):lower() .. "\\"
            return json.encode({folder = folder})
        end
    end
    return "{}"
end

function LauncherRunningExecutables(payload)
    local folders = payload and json.decode(payload).folders or {}
    local prefixes = {}
    for _, folder in ipairs(folders) do
        if type(folder) == "string" and #folder < 4096 then
            local wide = ffi.new("uint16_t[4096]")
            local length = kernel.MultiByteToWideChar(65001, 8, folder, -1, wide, 4096)
            if length > 1 then prefixes[folder] = {wide = wide, length = length - 1} end
        end
    end
    local path = ffi.new("uint16_t[32768]")
    local size = ffi.new("uint32_t[1]")
    local snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
    if snapshot == invalid_handle then return json.encode({ error = "No se pudieron leer los procesos de Windows." }) end
    local entry = ffi.new("LauncherProcessEntry")
    entry.size = ffi.sizeof(entry)
    local names = {}
    local buffer = ffi.new("char[1040]")
    local found = kernel.Process32FirstW(snapshot, entry)
    while found ~= 0 do
        local count = kernel.WideCharToMultiByte(65001, 0, entry.exe, -1, buffer, 1040, nil, nil)
        if count > 1 then names[ffi.string(buffer, count - 1):lower()] = true end
        if next(prefixes) ~= nil then
            local process = kernel.OpenProcess(0x1000, 0, entry.pid)
            if process ~= nil then
                size[0] = 32768
                if kernel.QueryFullProcessImageNameW(process, 0, path, size) ~= 0 then
                    for folder, prefix in pairs(prefixes) do
                        if size[0] > prefix.length
                            and kernel.CompareStringOrdinal(prefix.wide, prefix.length, path, prefix.length, 1) == 2 then
                            names[folder] = true
                        end
                    end
                end
                kernel.CloseHandle(process)
            end
        end
        found = kernel.Process32NextW(snapshot, entry)
    end
    kernel.CloseHandle(snapshot)
    return json.encode(names)
end

jit.off(LauncherRunningExecutables)

local launcherExecutables = {
    epicgameslauncher = "epicgameslauncher.exe",
    eadesktop = "eadesktop.exe",
    upc = "upc.exe",
    galaxyclient = "galaxyclient.exe",
    battle_net = "battle.net.exe",
}

local launcherLocations = {
    epicgameslauncher = {
        {"ProgramFiles(x86)", [[Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe]]},
        {"ProgramFiles(x86)", [[Epic Games\Launcher\Portal\Binaries\Win32\EpicGamesLauncher.exe]]}
    },
    eadesktop = {{"ProgramFiles", [[Electronic Arts\EA Desktop\EA Desktop\EADesktop.exe]]}},
    upc = {{"ProgramFiles(x86)", [[Ubisoft\Ubisoft Game Launcher\upc.exe]]}},
    galaxyclient = {{"ProgramFiles(x86)", [[GOG Galaxy\GalaxyClient.exe]]}},
    battle_net = {{"ProgramFiles(x86)", [[Battle.net\Battle.net.exe]]}}
}

function LauncherResolve(payload)
    local key = json.decode(payload).key
    if type(key) ~= "string" then return "{}" end
    local locations = launcherLocations[key]
    if not locations then return "{}" end
    local executable = launcherExecutables[key]
    local snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
    local buffer = ffi.new("char[4096]")
    if snapshot ~= invalid_handle then
        local entry = ffi.new("LauncherProcessEntry")
        local wide = ffi.new("uint16_t[32768]")
        local size = ffi.new("uint32_t[1]")
        entry.size = ffi.sizeof(entry)
        local found = kernel.Process32FirstW(snapshot, entry)
        while found ~= 0 do
            local count = kernel.WideCharToMultiByte(65001, 0, entry.exe, -1, buffer, 4096, nil, nil)
            if count > 1 and ffi.string(buffer, count - 1):lower() == executable then
                local process = kernel.OpenProcess(0x1000, 0, entry.pid)
                if process ~= nil then
                    size[0] = 32768
                    local ok = kernel.QueryFullProcessImageNameW(process, 0, wide, size)
                    kernel.CloseHandle(process)
                    if ok ~= 0 then
                        count = kernel.WideCharToMultiByte(65001, 0, wide, -1, buffer, 4096, nil, nil)
                        if count > 1 then
                            kernel.CloseHandle(snapshot)
                            return json.encode({path=ffi.string(buffer, count - 1)})
                        end
                    end
                end
            end
            found = kernel.Process32NextW(snapshot, entry)
        end
        kernel.CloseHandle(snapshot)
    end
    for _, location in ipairs(locations) do
        local base = os.getenv(location[1])
        if base then
            local path = base .. [[\]] .. location[2]
            local file = io.open(path, "rb")
            if file then file:close(); return json.encode({path=path}) end
        end
    end
    return "{}"
end

function LauncherClose(payload)
    local request = json.decode(payload)
    local path = request.path
    if type(path) ~= "string" or not path:match("^%a:[/\\]") or #path > 4096
        or not path:lower():match("%.exe$") or path:find("%z") then
        return json.encode({ error = "La ruta del launcher debe apuntar a un .exe." })
    end
    local expected = ffi.new("uint16_t[4097]")
    if kernel.MultiByteToWideChar(65001, 8, path, -1, expected, 4097) == 0 then
        return json.encode({ error = "La ruta del launcher no es válida." })
    end
    local pid = ffi.new("uint32_t[1]")
    local path_buffer = ffi.new("uint16_t[32768]")
    local size = ffi.new("uint32_t[1]")
    local function matches(process)
        size[0] = 32768
        return kernel.QueryFullProcessImageNameW(process, 0, path_buffer, size) ~= 0
            and kernel.CompareStringOrdinal(expected, -1, path_buffer, -1, 1) == 2
    end

    local leaf = path:lower():match("[^/\\]+$")
    local can_finish = false
    for _, executable in pairs(launcherExecutables) do
        if leaf == executable then can_finish = true; break end
    end
    if (request.finishLauncher or request.finishEpic) and can_finish then
        local snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
        if snapshot == invalid_handle then return json.encode({error = "No se pudieron leer los procesos de Windows."}) end
        local entry = ffi.new("LauncherProcessEntry")
        entry.size = ffi.sizeof(entry)
        local count = 0
        local failed = false
        local launcher_name = ffi.new("uint16_t[32]")
        kernel.MultiByteToWideChar(65001, 0, leaf, -1, launcher_name, 32)
        local found = kernel.Process32FirstW(snapshot, entry)
        while found ~= 0 do
            local process
            if kernel.CompareStringOrdinal(launcher_name, -1, entry.exe, -1, 1) == 2 then
                process = kernel.OpenProcess(0x1001, 0, entry.pid)
                if process == nil then failed = true end
            end
            if process ~= nil then
                if matches(process) then
                    if kernel.TerminateProcess(process, 0) ~= 0 then count = count + 1
                    else failed = true end
                end
                kernel.CloseHandle(process)
            end
            found = kernel.Process32NextW(snapshot, entry)
        end
        kernel.CloseHandle(snapshot)
        if failed then return json.encode({error = "Windows no permitió cerrar el launcher."}) end
        return json.encode({terminated = count})
    end

    local sent = 0
    local callback = ffi.cast("int (__stdcall *)(void *, intptr_t)", function(window)
        if user.IsWindowVisible(window) == 0 then return 1 end
        user.GetWindowThreadProcessId(window, pid)
        local process = kernel.OpenProcess(0x1000, 0, pid[0])
        if process ~= nil then
            if matches(process) then
                if user.PostMessageW(window, 0x0010, 0, 0) ~= 0 then sent = sent + 1 end
            end
            kernel.CloseHandle(process)
        end
        return 1
    end)
    user.EnumWindows(callback, 0)
    callback:free()
    return json.encode({ windows = sent })
end
jit.off(LauncherClose)

return { on_load = function() millennium.ready() end }
