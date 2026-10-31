-- Saved progress (coins, rank, stats) in a Roblox DataStore.
-- In Studio this needs: Game Settings -> Security -> "Enable Studio Access to API Services".
-- If the DataStore is unavailable the game still runs; progress just isn't saved.
local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")

local STORE_NAME = "Profile_v1"
local DEFAULT = { coins = 500, rr = 0, played = 0, wins = 0, kills = 0, deaths = 0 }

local store: DataStore? = nil
do
	local ok, result = pcall(function()
		return DataStoreService:GetDataStore(STORE_NAME)
	end)
	if ok then
		store = result
	else
		warn("[PlayerData] DataStore unavailable, progress will not save:", result)
	end
end

local PlayerData = {}
local profiles: { [Player]: { [string]: number } } = {}
local loaded: { [Player]: boolean } = {}

local function key(player: Player): string
	return "u_" .. player.UserId
end

local function publish(player: Player)
	local p = profiles[player]
	if not p then
		return
	end
	for k, v in p do
		player:SetAttribute("Saved_" .. k, v)
	end
end

function PlayerData.load(player: Player)
	local data = table.clone(DEFAULT)
	if store then
		for attempt = 1, 3 do
			local ok, result = pcall(function()
				return store:GetAsync(key(player))
			end)
			if ok then
				if type(result) == "table" then
					for k, v in result do
						if type(v) == "number" and DEFAULT[k] ~= nil then
							data[k] = v
						end
					end
				end
				loaded[player] = true
				break
			end
			warn("[PlayerData] load failed (attempt " .. attempt .. "):", result)
			task.wait(attempt)
		end
	end
	profiles[player] = data
	publish(player)
end

function PlayerData.get(player: Player)
	return profiles[player]
end

function PlayerData.add(player: Player, field: string, amount: number)
	local p = profiles[player]
	if not p or p[field] == nil then
		return
	end
	p[field] = math.max(0, p[field] + amount)
	publish(player)
end

function PlayerData.save(player: Player)
	local p = profiles[player]
	-- never overwrite saved progress with defaults if the load failed
	if not store or not p or not loaded[player] then
		return
	end
	local ok, err = pcall(function()
		store:SetAsync(key(player), p)
	end)
	if not ok then
		warn("[PlayerData] save failed:", err)
	end
end

function PlayerData.release(player: Player)
	PlayerData.save(player)
	profiles[player] = nil
	loaded[player] = nil
end

Players.PlayerRemoving:Connect(PlayerData.release)
game:BindToClose(function()
	for _, player in Players:GetPlayers() do
		task.spawn(PlayerData.save, player)
	end
	task.wait(2)
end)

return PlayerData
