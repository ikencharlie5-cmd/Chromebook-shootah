-- Core Rush match server: teams, rounds, economy, server-checked shooting, the Core (plant/defuse),
-- and saving results. Clients read match state from attributes on Workspace and on their Player.
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local Teams = game:GetService("Teams")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage.Shared
local Config = require(Shared.Config)
local Weapons = require(Shared.Weapons)
local Maps = require(Shared.Maps)
local Ranks = require(Shared.Ranks)
local MapBuilder = require(script.Parent.MapBuilder)
local PlayerData = require(script.Parent.PlayerData)

local Match = {}

local M = Config.STUDS_PER_M
local IS_STUDIO = RunService:IsStudio()
local MIN_PLAYERS = IS_STUDIO and 1 or Config.MIN_PLAYERS

-- ---------------------------------------------------------------------------------------------
-- remotes

local remotes = Instance.new("Folder")
remotes.Name = "Remotes"
local function remote(name: string, kind: string?)
	local r = Instance.new(kind or "RemoteEvent")
	r.Name = name
	r.Parent = remotes
	return r
end
local R = {
	Fire = remote("Fire"),          -- client -> server: a shot (or knife swing)
	Reload = remote("Reload"),
	Equip = remote("Equip"),
	Action = remote("Action"),      -- plant / defuse start + stop
	Buy = remote("Buy", "RemoteFunction"),
	Loadout = remote("Loadout"),    -- server -> client: weapons + ammo
	Feed = remote("Feed"),          -- kill feed
	Hit = remote("Hit"),            -- hit marker for the shooter
	Hurt = remote("Hurt"),          -- damage direction for the victim
	Effect = remote("Effect"),      -- other players' tracers / sounds
	Banner = remote("Banner"),      -- big centre messages
	Results = remote("Results"),    -- end of match
}
remotes.Parent = ReplicatedStorage

-- ---------------------------------------------------------------------------------------------
-- teams

local TEAM_INFO = {
	{ name = "Blue", color = BrickColor.new("Bright bluish green") },
	{ name = "Red", color = BrickColor.new("Bright red") },
}
local teamObjects = {}
for i, info in TEAM_INFO do
	local t = Instance.new("Team")
	t.Name = info.name
	t.TeamColor = info.color
	t.AutoAssignable = false
	t.Parent = Teams
	teamObjects[i] = t
end

-- ---------------------------------------------------------------------------------------------
-- state

type Ammo = { mag: number, reserve: number }
type Combatant = {
	player: Player,
	team: number,
	alive: boolean,
	credits: number,
	shield: number,
	primary: string?,
	secondary: string,
	slot: string,
	ammo: { [string]: Ammo },
	lastShot: number,
	nextHeavy: number,
	reloadUntil: number,
	reloadToken: number,
	kills: number,
	deaths: number,
	assists: number,
	roundKills: number,
	damageBy: { [Player]: number },
	lastHit: { by: Player, weapon: string, head: boolean }?,
	hasCore: boolean,
	action: string?,
	actionT: number,
}

local C: { [Player]: Combatant } = {}
local state = {
	phase = "waiting",
	round = 0,
	score = { 0, 0 },
	attackTeam = 1,
	lossStreak = { 0, 0 },
	map = nil :: any,
	winner = nil :: number?,
	reason = "",
	enemiesAtStart = { 0, 0 },
	core = {
		holder = nil :: Player?,
		part = nil :: BasePart?,
		planted = false,
		site = nil :: string?,
		explodeAt = 0,
	},
}

local function now(): number
	return workspace:GetServerTimeNow()
end

local function setPhase(phase: string, duration: number?)
	state.phase = phase
	workspace:SetAttribute("Phase", phase)
	workspace:SetAttribute("PhaseEnd", duration and (now() + duration) or 0)
end

local function publishMatch()
	workspace:SetAttribute("Round", state.round)
	workspace:SetAttribute("ScoreBlue", state.score[1])
	workspace:SetAttribute("ScoreRed", state.score[2])
	workspace:SetAttribute("AttackTeam", teamObjects[state.attackTeam].Name)
	workspace:SetAttribute("MapName", state.map and state.map.name or "")
	workspace:SetAttribute("WinRounds", Config.WIN_ROUNDS)
end

local function publish(c: Combatant)
	local p = c.player
	p:SetAttribute("Credits", c.credits)
	p:SetAttribute("Shield", c.shield)
	p:SetAttribute("Kills", c.kills)
	p:SetAttribute("Deaths", c.deaths)
	p:SetAttribute("Assists", c.assists)
	p:SetAttribute("Alive", c.alive)
	p:SetAttribute("HasCore", c.hasCore)
	p:SetAttribute("Side", c.team == state.attackTeam and "ATK" or "DEF")
end

local function sendLoadout(c: Combatant)
	R.Loadout:FireClient(c.player, {
		primary = c.primary,
		secondary = c.secondary,
		slot = c.slot,
		ammo = c.ammo,
	})
end

local function sideOf(team: number): string
	return team == state.attackTeam and "T" or "D"
end

local function teamCount(team: number): number
	local n = 0
	for _, c in C do
		if c.team == team then
			n += 1
		end
	end
	return n
end

local function aliveCount(team: number): number
	local n = 0
	for _, c in C do
		if c.team == team and c.alive then
			n += 1
		end
	end
	return n
end

local function rootOf(player: Player): BasePart?
	local char = player.Character
	return char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
end

local function humanoidOf(player: Player): Humanoid?
	local char = player.Character
	return char and char:FindFirstChildOfClass("Humanoid")
end

local function freshAmmo(id: string): Ammo
	local w = Weapons[id]
	return { mag = w.mag or 0, reserve = w.reserve or 0 }
end

local function resetLoadout(c: Combatant)
	c.primary = nil
	c.secondary = "pip"
	c.slot = "secondary"
	c.ammo = { pip = freshAmmo("pip") }
	c.shield = 0
end

-- ---------------------------------------------------------------------------------------------
-- third-person gun models (simple blocks so other players can see what you hold)

local GUN_SIZE = {
	pistol = Vector3.new(0.35, 0.6, 1.3),
	smg = Vector3.new(0.35, 0.7, 2.0),
	rifle = Vector3.new(0.35, 0.7, 3.0),
	shotgun = Vector3.new(0.4, 0.6, 3.0),
	lmg = Vector3.new(0.5, 0.9, 3.3),
	sniper = Vector3.new(0.35, 0.7, 3.8),
	knife = Vector3.new(0.12, 0.25, 1.2),
}
local function showGun(c: Combatant)
	local char = c.player.Character
	if not char then
		return
	end
	local hand = char:FindFirstChild("RightHand") or char:FindFirstChild("Right Arm")
	if not hand then
		return
	end
	local old = char:FindFirstChild("HeldGun")
	if old then
		old:Destroy()
	end
	local id = c.slot == "melee" and "knife" or (c.slot == "primary" and c.primary or c.secondary)
	if not id then
		return
	end
	local kind = Weapons[id].kind or "pistol"
	local gun = Instance.new("Part")
	gun.Name = "HeldGun"
	gun.Size = GUN_SIZE[kind] or GUN_SIZE.pistol
	gun.Color = kind == "knife" and Color3.fromRGB(200, 205, 215) or Color3.fromRGB(35, 38, 45)
	gun.Material = kind == "knife" and Enum.Material.Metal or Enum.Material.SmoothPlastic
	gun.CanCollide = false
	gun.CanQuery = false
	gun.Massless = true
	gun.CFrame = (hand :: BasePart).CFrame * CFrame.new(0, -0.3, -gun.Size.Z / 2 + 0.3)
	local weld = Instance.new("WeldConstraint")
	weld.Part0 = hand :: BasePart
	weld.Part1 = gun
	weld.Parent = gun
	gun.Parent = char
end

-- ---------------------------------------------------------------------------------------------
-- the Core

local function clearCore()
	local core = state.core
	if core.part then
		core.part:Destroy()
	end
	if core.holder and C[core.holder] then
		C[core.holder].hasCore = false
		publish(C[core.holder])
	end
	core.holder = nil
	core.part = nil
	core.planted = false
	core.site = nil
	core.explodeAt = 0
	workspace:SetAttribute("CorePlanted", false)
	workspace:SetAttribute("CoreSite", "")
	workspace:SetAttribute("CoreExplodeAt", 0)
end

local function corePart(pos: Vector3, planted: boolean): BasePart
	local p = Instance.new("Part")
	p.Name = "Core"
	p.Shape = Enum.PartType.Ball
	p.Size = Vector3.new(2.2, 2.2, 2.2)
	p.Anchored = true
	p.CanCollide = false
	p.Material = Enum.Material.Neon
	p.Color = planted and Color3.fromRGB(255, 70, 70) or Color3.fromRGB(255, 210, 63)
	p.Position = pos + Vector3.new(0, 1.1, 0)
	local light = Instance.new("PointLight")
	light.Color = p.Color
	light.Range = 16
	light.Brightness = 3
	light.Parent = p
	local hl = Instance.new("Highlight")
	hl.FillTransparency = 1
	hl.OutlineColor = p.Color
	hl.DepthMode = Enum.HighlightDepthMode.AlwaysOnTop
	hl.Parent = p
	p.Parent = workspace
	return p
end

local function giveCore(player: Player)
	local core = state.core
	if core.part then
		core.part:Destroy()
		core.part = nil
	end
	core.holder = player
	local c = C[player]
	c.hasCore = true
	publish(c)
	R.Banner:FireClient(player, { title = "YOU HAVE THE CORE", sub = "Plant it at site A or B (hold F)", kind = "info", time = 3 })
end

local function dropCore(player: Player)
	local core = state.core
	if core.holder ~= player then
		return
	end
	local root = rootOf(player)
	local pos = root and root.Position or Vector3.zero
	-- drop onto the ground under the player
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Include
	params.FilterDescendantsInstances = { state.map.model }
	local hit = workspace:Raycast(pos, Vector3.new(0, -50, 0), params)
	core.holder = nil
	core.part = corePart(hit and hit.Position or pos, false)
	if C[player] then
		C[player].hasCore = false
		publish(C[player])
	end
end

local function inSite(pos: Vector3): string?
	for letter, s in state.map.sites do
		if pos.X >= s.min.X and pos.X <= s.max.X and pos.Z >= s.min.Z and pos.Z <= s.max.Z then
			return letter
		end
	end
	return nil
end

-- ---------------------------------------------------------------------------------------------
-- spawning

local function spawnPlayer(c: Combatant, index: number)
	local player = c.player
	local spawnInfo = state.map.spawns[sideOf(c.team)]
	local points = spawnInfo.points
	local pos = points[((index - 1) % #points) + 1]
	player:LoadCharacter()
	local char = player.Character or player.CharacterAdded:Wait()
	local hum = char:WaitForChild("Humanoid") :: Humanoid
	hum.MaxHealth = Config.MAX_HEALTH
	hum.Health = Config.MAX_HEALTH
	hum.BreakJointsOnDeath = false
	-- teammates' names show through walls, enemies' only when you can see them
	hum.NameOcclusion = Enum.NameOcclusion.EnemyOcclusion
	-- face the middle of the map
	local look = Vector3.new(0, pos.Y + 3, 0)
	char:PivotTo(CFrame.lookAt(pos + Vector3.new(0, 3.5, 0), Vector3.new(look.X, pos.Y + 3.5, look.Z)))
	c.alive = true
	c.action = nil
	c.actionT = 0
	c.reloadUntil = 0
	c.damageBy = {}
	c.lastHit = nil
	c.roundKills = 0
	publish(c)
	sendLoadout(c)
	showGun(c)
	hum.Died:Connect(function()
		if player.Character == char and C[player] == c then
			Match.onDeath(c)
		end
	end)
end

-- keep players in their spawn zone during the buy phase
local function clampToSpawn(c: Combatant)
	local root = rootOf(c.player)
	if not root then
		return
	end
	local zone = state.map.spawns[sideOf(c.team)]
	local p = root.Position
	local x = math.clamp(p.X, zone.min.X, zone.max.X)
	local z = math.clamp(p.Z, zone.min.Z, zone.max.Z)
	if x ~= p.X or z ~= p.Z then
		root.AssemblyLinearVelocity = Vector3.zero
		root.CFrame = CFrame.new(Vector3.new(x, p.Y, z)) * root.CFrame.Rotation
	end
end

-- ---------------------------------------------------------------------------------------------
-- practice dummies (only when testing alone in Studio, so there is something to shoot)

local dummies = {}
local function spawnDummies()
	for _, d in dummies do
		d:Destroy()
	end
	table.clear(dummies)
	if not IS_STUDIO or #Players:GetPlayers() > 1 then
		return
	end
	local side = state.attackTeam == 1 and "D" or "T"
	-- dummies stand in the enemy spawn
	local first = next(C)
	if first and C[first] then
		side = sideOf(C[first].team) == "T" and "D" or "T"
	end
	local points = state.map.spawns[side].points
	for i = 1, math.min(5, #points) do
		local ok, model = pcall(function()
			return Players:CreateHumanoidModelFromDescription(Instance.new("HumanoidDescription"), Enum.HumanoidRigType.R15)
		end)
		if ok and model then
			model.Name = "Dummy"
			model:SetAttribute("Dummy", true)
			local hum = model:FindFirstChildOfClass("Humanoid")
			if hum then
				hum.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None
				hum.Died:Connect(function()
					task.delay(3, function()
						if model.Parent then
							model:Destroy()
						end
					end)
				end)
			end
			model:PivotTo(CFrame.new(points[(i * 3) % #points + 1] + Vector3.new(0, 3.5, 0)))
			model.Parent = workspace
			table.insert(dummies, model)
		end
	end
end

-- ---------------------------------------------------------------------------------------------
-- damage

local function zoneOf(partName: string): string
	if partName == "Head" then
		return "head"
	end
	if string.find(partName, "Leg") or string.find(partName, "Foot") then
		return "leg"
	end
	return "body"
end

local function applyDamage(attacker: Combatant, victimChar: Model, amount: number, head: boolean, weaponId: string)
	local hum = victimChar:FindFirstChildOfClass("Humanoid")
	if not hum or hum.Health <= 0 then
		return
	end
	local victimPlayer = Players:GetPlayerFromCharacter(victimChar)
	local victim = victimPlayer and C[victimPlayer]
	if victim then
		if not victim.alive or victim.team == attacker.team then
			return
		end
		if victim.shield > 0 then
			local absorbed = math.min(victim.shield, amount)
			victim.shield -= absorbed
			amount -= absorbed
			publish(victim)
		end
		victim.damageBy[attacker.player] = (victim.damageBy[attacker.player] or 0) + amount
		victim.lastHit = { by = attacker.player, weapon = weaponId, head = head }
	end
	local willKill = hum.Health - amount <= 0
	R.Hit:FireClient(attacker.player, { damage = math.round(amount), head = head, kill = willKill })
	if victimPlayer then
		local root = rootOf(attacker.player)
		R.Hurt:FireClient(victimPlayer, { from = root and root.Position or Vector3.zero, damage = math.round(amount) })
	end
	hum:TakeDamage(amount)
end

-- ---------------------------------------------------------------------------------------------
-- shooting (the client aims and reports what it hit; the server checks it is believable)

local mapParams = RaycastParams.new()
mapParams.FilterType = Enum.RaycastFilterType.Include

local function damageFor(w, zone: string, distStuds: number, heavy: boolean): number
	local table_ = heavy and w.heavyDmg or w.dmg
	local dmg = table_[zone] or table_.body
	local meters = distStuds / M
	if w.pellets then
		-- shotgun: full damage up close, falling to 35% at long range
		local t = math.clamp((meters - w.closeRange) / (w.farRange - w.closeRange), 0, 1)
		dmg *= 1 - t * 0.65
	elseif w.falloff and meters > w.falloff[1] then
		dmg *= w.falloff[2]
	end
	return dmg
end

local function onFire(player: Player, weaponId: string, origin: Vector3, shots: { any }, heavy: boolean?)
	local c = C[player]
	if not c or not c.alive or state.phase == "waiting" or state.phase == "matchEnd" then
		return
	end
	if typeof(weaponId) ~= "string" or typeof(origin) ~= "Vector3" or typeof(shots) ~= "table" then
		return
	end
	local w = Weapons[weaponId]
	if not w then
		return
	end
	-- must own and hold it
	local owned = weaponId == "knife" or weaponId == c.primary or weaponId == c.secondary
	if not owned then
		return
	end
	if state.phase == "buy" then
		return -- no shooting in the buy phase
	end
	local t = os.clock()
	if heavy and w.melee then
		if t < c.nextHeavy then
			return
		end
		c.nextHeavy = t + w.heavyCool * 0.85
	else
		local interval = 60 / w.rpm
		if t - c.lastShot < interval * 0.75 then
			return
		end
	end
	c.lastShot = t
	if not w.melee then
		if t < c.reloadUntil then
			return
		end
		local ammo = c.ammo[weaponId]
		if not ammo or ammo.mag <= 0 then
			return
		end
		ammo.mag -= 1
	end
	local root = rootOf(player)
	local head = player.Character and player.Character:FindFirstChild("Head") :: BasePart?
	if not root or not head or (origin - head.Position).Magnitude > 10 then
		return
	end
	local maxShots = w.pellets or 1
	local ends = {}
	mapParams.FilterDescendantsInstances = { state.map.model }
	for i, shot in shots do
		if i > maxShots or typeof(shot) ~= "table" then
			break
		end
		local hitPos = shot.pos
		if typeof(hitPos) ~= "Vector3" then
			continue
		end
		table.insert(ends, hitPos)
		local hitPart = shot.part
		if typeof(hitPart) ~= "Instance" or not hitPart:IsA("BasePart") or not hitPart:IsDescendantOf(workspace) then
			continue
		end
		local char = hitPart:FindFirstAncestorOfClass("Model")
		while char and not char:FindFirstChildOfClass("Humanoid") and char.Parent ~= workspace do
			char = char.Parent:FindFirstAncestorOfClass("Model")
		end
		if not char or not char:FindFirstChildOfClass("Humanoid") then
			continue
		end
		-- believable: the reported point is near the part, in range, and not through a wall
		if (hitPart.Position - hitPos).Magnitude > hitPart.Size.Magnitude / 2 + 6 then
			continue
		end
		local dist = (hitPos - origin).Magnitude
		if w.melee then
			local range = (heavy and w.heavyRange or w.range) * M + 3
			if dist > range then
				continue
			end
		end
		local toHit = hitPos - origin
		local wall = workspace:Raycast(origin, toHit.Unit * math.max(0, toHit.Magnitude - 1.5), mapParams)
		if wall then
			continue
		end
		local zone = zoneOf(hitPart.Name)
		applyDamage(c, char, damageFor(w, zone, dist, heavy == true), zone == "head", weaponId)
	end
	R.Effect:FireAllClients({ shooter = player, weapon = weaponId, origin = origin, ends = ends })
end

local function onReload(player: Player)
	local c = C[player]
	if not c or not c.alive then
		return
	end
	local id = c.slot == "primary" and c.primary or (c.slot == "secondary" and c.secondary or nil)
	if not id then
		return
	end
	local w, ammo = Weapons[id], c.ammo[id]
	if not ammo or ammo.mag >= w.mag or ammo.reserve <= 0 or os.clock() < c.reloadUntil then
		return
	end
	c.reloadUntil = os.clock() + w.reload
	c.reloadToken += 1
	local token = c.reloadToken
	task.delay(w.reload, function()
		if C[player] ~= c or not c.alive or c.ammo[id] ~= ammo or c.reloadToken ~= token then
			return
		end
		local take = math.min(w.mag - ammo.mag, ammo.reserve)
		ammo.mag += take
		ammo.reserve -= take
		sendLoadout(c)
	end)
end

local function onEquip(player: Player, slot: string)
	local c = C[player]
	if not c or not c.alive then
		return
	end
	if slot == "primary" and not c.primary then
		return
	end
	if slot ~= "primary" and slot ~= "secondary" and slot ~= "melee" then
		return
	end
	c.slot = slot
	c.reloadUntil = 0
	c.reloadToken += 1 -- switching weapons cancels a reload
	showGun(c)
end

local function inSpawn(c: Combatant): boolean
	local root = rootOf(c.player)
	if not root then
		return false
	end
	local zone = state.map.spawns[sideOf(c.team)]
	local p = root.Position
	return p.X >= zone.min.X - 2 and p.X <= zone.max.X + 2 and p.Z >= zone.min.Z - 2 and p.Z <= zone.max.Z + 2
end

local function onBuy(player: Player, item: string): (boolean, string)
	local c = C[player]
	if not c or not c.alive then
		return false, "You are dead"
	end
	if state.phase ~= "buy" then
		return false, "You can only buy during the buy phase"
	end
	if not inSpawn(c) then
		return false, "Go back to spawn to buy"
	end
	if typeof(item) ~= "string" then
		return false, "?"
	end
	local shield = Weapons.SHIELDS[item]
	if shield then
		if c.shield >= shield.value then
			return false, "You already have that shield"
		end
		if c.credits < shield.price then
			return false, "Not enough credits"
		end
		c.credits -= shield.price
		c.shield = shield.value
		publish(c)
		return true, shield.name
	end
	local w = Weapons[item]
	if not w or w.melee then
		return false, "?"
	end
	if c.primary == item or c.secondary == item then
		return false, "You already have it"
	end
	if c.credits < w.price then
		return false, "Not enough credits"
	end
	c.credits -= w.price
	if w.slot == "primary" then
		if c.primary then
			c.ammo[c.primary] = nil
		end
		c.primary = item
		c.slot = "primary"
	else
		if c.secondary then
			c.ammo[c.secondary] = nil
		end
		c.secondary = item
		c.slot = "secondary"
	end
	c.ammo[item] = freshAmmo(item)
	publish(c)
	sendLoadout(c)
	showGun(c)
	return true, w.name
end

local function onAction(player: Player, action: string?)
	local c = C[player]
	if not c then
		return
	end
	if action == "plant" or action == "defuse" then
		c.action = action
		c.actionT = 0
	else
		c.action = nil
		c.actionT = 0
	end
end

-- ---------------------------------------------------------------------------------------------
-- deaths and rounds

local function endRound(winner: number, reason: string)
	if state.winner then
		return
	end
	state.winner = winner
	state.reason = reason
end

function Match.onDeath(c: Combatant)
	if not c.alive then
		return
	end
	c.alive = false
	c.deaths += 1
	c.action = nil
	if state.core.holder == c.player then
		dropCore(c.player)
	end
	local hit = c.lastHit
	local killer = hit and C[hit.by]
	if killer and killer ~= c then
		killer.kills += 1
		killer.roundKills += 1
		killer.credits = math.min(Config.MAX_CREDITS, killer.credits + Config.KILL_REWARD)
		publish(killer)
		local need = state.enemiesAtStart[killer.team]
		if need >= 3 and killer.roundKills >= need then
			R.Banner:FireAllClients({ title = "ACE", sub = killer.player.DisplayName, kind = "ace", time = 3 })
		end
	end
	-- assists: anyone else who did 30+ damage
	local assisters = {}
	for by, dmg in c.damageBy do
		local a = C[by]
		if a and a ~= killer and a.team ~= c.team and dmg >= 30 then
			a.assists += 1
			a.credits = math.min(Config.MAX_CREDITS, a.credits + Config.ASSIST_REWARD)
			publish(a)
			table.insert(assisters, by.DisplayName)
		end
	end
	publish(c)
	R.Feed:FireAllClients({
		killer = killer and killer.player.DisplayName or nil,
		killerTeam = killer and killer.team or nil,
		victim = c.player.DisplayName,
		victimTeam = c.team,
		weapon = hit and hit.weapon or nil,
		head = hit and hit.head or false,
		assists = assisters,
	})
end

local function checkRoundEnd()
	local atk, def = state.attackTeam, 3 - state.attackTeam
	local core = state.core
	local atkAlive, defAlive = aliveCount(atk), aliveCount(def)
	local atkHad, defHad = state.enemiesAtStart[def] > 0, state.enemiesAtStart[atk] > 0
	if core.planted then
		if now() >= core.explodeAt then
			local e = Instance.new("Explosion")
			e.Position = core.part and core.part.Position or Vector3.zero
			e.BlastRadius = 30
			e.BlastPressure = 0
			e.DestroyJointRadiusPercent = 0
			e.Parent = workspace
			for _, c in C do
				local root = rootOf(c.player)
				if c.alive and root and (root.Position - e.Position).Magnitude < 30 then
					local hum = humanoidOf(c.player)
					if hum then
						hum.Health = 0
					end
				end
			end
			endRound(atk, "detonated")
		elseif defHad and defAlive == 0 then
			endRound(atk, "eliminated")
		end
		return
	end
	if atkHad and atkAlive == 0 then
		endRound(def, "eliminated")
	elseif defHad and defAlive == 0 then
		endRound(atk, "eliminated")
	elseif now() >= (workspace:GetAttribute("PhaseEnd") :: number) then
		endRound(def, "time")
	end
end

-- plant / defuse progress, core pickup and the buy-phase barrier
local function onHeartbeat(dt: number)
	if not state.map then
		return
	end
	local core = state.core
	for _, c in C do
		if not c.alive then
			continue
		end
		if state.phase == "buy" then
			clampToSpawn(c)
			continue
		end
		local root = rootOf(c.player)
		if not root then
			continue
		end
		-- pick up a dropped core
		if not core.planted and not core.holder and core.part and sideOf(c.team) == "T"
			and (root.Position - core.part.Position).Magnitude < 5 then
			giveCore(c.player)
		end
		if state.phase ~= "live" or not c.action then
			continue
		end
		local still = root.AssemblyLinearVelocity.Magnitude < 3
		local ok = false
		local need = 0
		if c.action == "plant" then
			ok = still and c.hasCore and not core.planted and inSite(root.Position) ~= nil
			need = Config.PLANT_TIME
		elseif c.action == "defuse" then
			ok = still and core.planted and sideOf(c.team) == "D" and core.part ~= nil
				and (root.Position - core.part.Position).Magnitude < 8
			need = Config.DEFUSE_TIME
		end
		if not ok then
			c.actionT = 0
			c.player:SetAttribute("ActionProgress", 0)
			continue
		end
		c.actionT += dt
		c.player:SetAttribute("ActionProgress", c.actionT / need)
		if c.actionT >= need then
			c.player:SetAttribute("ActionProgress", 0)
			if c.action == "plant" then
				local site = inSite(root.Position) :: string
				core.holder = nil
				c.hasCore = false
				core.planted = true
				core.site = site
				core.explodeAt = now() + Config.CORE_TIME
				core.part = corePart(root.Position - Vector3.new(0, 3, 0), true)
				c.credits = math.min(Config.MAX_CREDITS, c.credits + Config.PLANT_REWARD)
				publish(c)
				workspace:SetAttribute("CorePlanted", true)
				workspace:SetAttribute("CoreSite", site)
				workspace:SetAttribute("CoreExplodeAt", core.explodeAt)
				setPhase("live", Config.CORE_TIME)
				R.Banner:FireAllClients({ title = "CORE PLANTED", sub = "Site " .. site, kind = "warn", time = 2.5 })
			else
				R.Banner:FireAllClients({ title = "CORE DEFUSED", sub = c.player.DisplayName, kind = "info", time = 2.5 })
				endRound(c.team, "defused")
			end
			c.action = nil
			c.actionT = 0
		end
	end
	if state.phase == "live" and not state.winner then
		checkRoundEnd()
	end
end

-- ---------------------------------------------------------------------------------------------
-- match flow

local function addCombatant(player: Player)
	-- join the smaller team
	local team = teamCount(1) <= teamCount(2) and 1 or 2
	local c: Combatant = {
		player = player, team = team, alive = false, credits = Config.START_CREDITS, shield = 0,
		primary = nil, secondary = "pip", slot = "secondary", ammo = {}, lastShot = 0, nextHeavy = 0,
		reloadUntil = 0, reloadToken = 0, kills = 0, deaths = 0, assists = 0, roundKills = 0, damageBy = {}, lastHit = nil,
		hasCore = false, action = nil, actionT = 0,
	}
	resetLoadout(c)
	C[player] = c
	player.Team = teamObjects[team]
	publish(c)
	-- joined during the buy phase: jump straight in
	if state.phase == "buy" then
		local n = teamCount(team)
		spawnPlayer(c, n)
	end
end

local function playerCount(): number
	local n = 0
	for _ in C do
		n += 1
	end
	return n
end

local function waitPhase()
	local finish = workspace:GetAttribute("PhaseEnd") :: number
	while now() < finish do
		task.wait(0.1)
		if state.winner then
			return
		end
	end
end

local function playRound()
	state.round += 1
	-- swap sides at half time
	if state.round == Config.HALF + 1 then
		state.attackTeam = 3 - state.attackTeam
		state.lossStreak = { 0, 0 }
		for _, c in C do
			c.credits = Config.START_CREDITS
			resetLoadout(c)
			c.alive = false
		end
		R.Banner:FireAllClients({ title = "SWITCHING SIDES", sub = "", kind = "info", time = 3 })
	end
	state.winner = nil
	clearCore()
	publishMatch()

	-- spawn everyone; survivors keep their gear, the dead get a pistol
	local index = { 0, 0 }
	for _, c in C do
		if not c.alive then
			resetLoadout(c)
		end
		index[c.team] += 1
		spawnPlayer(c, index[c.team])
	end
	state.enemiesAtStart = { teamCount(2), teamCount(1) }
	spawnDummies()
	setPhase("buy", state.round == 1 and Config.FIRST_BUY_TIME or Config.BUY_TIME)
	R.Banner:FireAllClients({ title = "ROUND " .. state.round, sub = "Buy phase (press B)", kind = "info", time = 2.5 })
	waitPhase()

	setPhase("live", Config.ROUND_TIME)
	-- hand the core to a random attacker
	local attackers = {}
	for p, c in C do
		if c.team == state.attackTeam and c.alive then
			table.insert(attackers, p)
		end
	end
	if #attackers > 0 then
		giveCore(attackers[math.random(#attackers)])
	end
	while not state.winner do
		task.wait(0.1)
		if playerCount() < MIN_PLAYERS then
			endRound(state.attackTeam, "left")
		end
	end

	-- round result + money
	local win, lose = state.winner :: number, 3 - (state.winner :: number)
	state.score[win] += 1
	state.lossStreak[win] = 0
	state.lossStreak[lose] = math.min(state.lossStreak[lose] + 1, 3)
	for _, c in C do
		local bonus = c.team == win and Config.WIN_BONUS or (Config.LOSS_BONUS + state.lossStreak[lose] * Config.LOSS_STREAK_BONUS)
		c.credits = math.min(Config.MAX_CREDITS, c.credits + bonus)
		publish(c)
	end
	publishMatch()
	setPhase("roundEnd", Config.END_TIME)
	local reasons = {
		eliminated = "Team eliminated", time = "Time ran out", detonated = "The Core detonated",
		defused = "The Core was defused", left = "Not enough players",
	}
	R.Banner:FireAllClients({ title = teamObjects[win].Name:upper() .. " WINS THE ROUND", sub = reasons[state.reason] or "", kind = "round", winTeam = win, time = Config.END_TIME - 0.5 })
	task.wait(Config.END_TIME)
end

local function endMatch()
	local s = state.score
	local winner = s[1] > s[2] and 1 or (s[2] > s[1] and 2 or 0)
	setPhase("matchEnd", 12)
	local results = {}
	for p, c in C do
		local won = c.team == winner
		local mine, theirs = s[c.team], s[3 - c.team]
		local delta = Ranks.rrDelta(won, mine, theirs, c.kills, c.deaths)
		local coins = Config.COINS_PER_MATCH + c.kills * Config.COINS_PER_KILL + (won and Config.COINS_PER_WIN or 0)
		PlayerData.add(p, "rr", delta)
		PlayerData.add(p, "coins", coins)
		PlayerData.add(p, "played", 1)
		PlayerData.add(p, "kills", c.kills)
		PlayerData.add(p, "deaths", c.deaths)
		if won then
			PlayerData.add(p, "wins", 1)
		end
		task.spawn(PlayerData.save, p)
		table.insert(results, {
			name = p.DisplayName, team = c.team, kills = c.kills, deaths = c.deaths, assists = c.assists,
		})
		R.Results:FireClient(p, { won = won, draw = winner == 0, rrDelta = delta, coins = coins, score = s, myTeam = c.team })
	end
	R.Results:FireAllClients({ table = results })
	task.wait(12)
end

local function resetMatch()
	state.round = 0
	state.score = { 0, 0 }
	state.lossStreak = { 0, 0 }
	state.attackTeam = 1
	local def = Maps[math.random(#Maps)]
	state.map = MapBuilder.build(def)
	-- rebalance teams
	local list = {}
	for p in C do
		table.insert(list, p)
	end
	for i, p in list do
		local c = C[p]
		c.team = (i % 2) + 1
		p.Team = teamObjects[c.team]
		c.credits = Config.START_CREDITS
		c.kills, c.deaths, c.assists = 0, 0, 0
		c.alive = false
		resetLoadout(c)
		publish(c)
	end
	publishMatch()
end

function Match.start()
	Players.PlayerAdded:Connect(function(player)
		PlayerData.load(player)
		if C[player] == nil and player.Parent then
			addCombatant(player)
		end
	end)
	for _, player in Players:GetPlayers() do
		task.spawn(function()
			PlayerData.load(player)
			addCombatant(player)
		end)
	end
	Players.PlayerRemoving:Connect(function(player)
		local c = C[player]
		if c and state.core.holder == player then
			dropCore(player)
		end
		C[player] = nil
	end)

	R.Fire.OnServerEvent:Connect(onFire)
	R.Reload.OnServerEvent:Connect(onReload)
	R.Equip.OnServerEvent:Connect(onEquip)
	R.Action.OnServerEvent:Connect(onAction)
	R.Buy.OnServerInvoke = onBuy
	RunService.Heartbeat:Connect(onHeartbeat)

	-- a lobby map to stand on while waiting
	state.map = MapBuilder.build(Maps[math.random(#Maps)])
	publishMatch()

	task.spawn(function()
		while true do
			setPhase("waiting")
			while playerCount() < MIN_PLAYERS do
				-- let early arrivals run around the map while they wait
				local i = 0
				for _, c in C do
					i += 1
					if not c.player.Character then
						task.spawn(spawnPlayer, c, i)
					end
				end
				task.wait(1)
			end
			task.wait(IS_STUDIO and 1 or 5)
			resetMatch()
			while state.score[1] < Config.WIN_ROUNDS and state.score[2] < Config.WIN_ROUNDS do
				playRound()
				if playerCount() < MIN_PLAYERS then
					break
				end
			end
			endMatch()
		end
	end)
end

return Match
