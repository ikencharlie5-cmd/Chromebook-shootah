-- First-person shooting: inputs, spread, recoil, reload, knife, scopes, movement modes,
-- plant/defuse, a simple viewmodel, tracers. The server re-checks every shot (Server/Match).
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local TweenService = game:GetService("TweenService")

local Shared = ReplicatedStorage.Shared
local Config = require(Shared.Config)
local Weapons = require(Shared.Weapons)
local Hud = require(script.Parent.Hud)

local player = Players.LocalPlayer
local camera = workspace.CurrentCamera
local Remotes = ReplicatedStorage:WaitForChild("Remotes")
local M = Config.STUDS_PER_M
local BASE_FOV = 75

-- ---------------------------------------------------------------- state
local loadout = { primary = nil :: string?, secondary = "pip", slot = "secondary", ammo = {} :: { [string]: { mag: number, reserve: number } } }
local held = "pip"
local triggerDown = false
local nextShot = 0
local burstLeft = 0
local reloadEnd = 0
local equipEnd = 0
local bloom = 0
local recoilShots = 0
local scoped = false
local crouching = false
local walking = false
local heavyCool = 0

local function currentId(): string?
	if loadout.slot == "melee" then
		return "knife"
	end
	if loadout.slot == "primary" then
		return loadout.primary
	end
	return loadout.secondary
end

local function hum(): Humanoid?
	local char = player.Character
	return char and char:FindFirstChildOfClass("Humanoid")
end

local function alive(): boolean
	local h = hum()
	return h ~= nil and h.Health > 0 and player:GetAttribute("Alive") == true
end

-- ---------------------------------------------------------------- viewmodel (blocks parented to the camera)
local viewmodel: Model? = nil
local VM_SIZE = {
	pistol = Vector3.new(0.18, 0.32, 0.8), smg = Vector3.new(0.2, 0.36, 1.25), rifle = Vector3.new(0.2, 0.36, 1.8),
	shotgun = Vector3.new(0.22, 0.32, 1.8), lmg = Vector3.new(0.28, 0.45, 2.0), sniper = Vector3.new(0.2, 0.36, 2.2),
	knife = Vector3.new(0.05, 0.12, 0.7),
}
local kick = 0
local swing = 0
local swingDir = 1

local function buildViewmodel(id: string?)
	if viewmodel then
		viewmodel:Destroy()
		viewmodel = nil
	end
	if not id then
		return
	end
	local w = Weapons[id]
	local kind = w.kind or "pistol"
	local model = Instance.new("Model")
	model.Name = "Viewmodel"
	local body = Instance.new("Part")
	body.Name = "Body"
	body.Size = VM_SIZE[kind] or VM_SIZE.pistol
	body.Color = kind == "knife" and Color3.fromRGB(205, 210, 220) or Color3.fromRGB(32, 35, 42)
	body.Material = kind == "knife" and Enum.Material.Metal or Enum.Material.SmoothPlastic
	body.Anchored = true
	body.CanCollide = false
	body.CanQuery = false
	body.CastShadow = false
	body.Parent = model
	-- hand
	local hand = Instance.new("Part")
	hand.Name = "Hand"
	hand.Size = Vector3.new(0.28, 0.28, 0.5)
	hand.Color = Color3.fromRGB(220, 170, 130)
	hand.Anchored = true
	hand.CanCollide = false
	hand.CanQuery = false
	hand.CastShadow = false
	hand.Parent = model
	-- muzzle flash light
	local flash = Instance.new("PointLight")
	flash.Name = "Flash"
	flash.Range = 10
	flash.Brightness = 0
	flash.Color = Color3.fromRGB(255, 200, 120)
	flash.Parent = body
	model.PrimaryPart = body
	model.Parent = camera
	viewmodel = model
end

local function updateViewmodel(dt: number)
	if not viewmodel then
		return
	end
	local body = viewmodel:FindFirstChild("Body") :: BasePart
	local hand = viewmodel:FindFirstChild("Hand") :: BasePart
	local h = hum()
	local speed = h and h.MoveDirection.Magnitude or 0
	local t = os.clock()
	local bob = CFrame.new(math.sin(t * 9) * 0.03 * speed, math.abs(math.cos(t * 9)) * 0.03 * speed, 0)
	kick = math.max(0, kick - dt * 6)
	local cf = camera.CFrame * CFrame.new(0.9, -0.85, -1.6 - body.Size.Z / 2 + kick * 0.25) * bob * CFrame.Angles(kick * 0.15, 0, 0)
	if currentId() == "knife" and swing > 0 then
		-- slash: sweep across the screen and roll the blade
		local k = 1 - swing
		local s = math.sin(k * math.pi)
		cf = cf * CFrame.new(-swingDir * s * 0.9, s * 0.25, -s * 0.3) * CFrame.Angles(-s * 0.6, swingDir * s * 0.9, swingDir * s * 1.2)
		swing = math.max(0, swing - dt / 0.38)
	end
	local reloading = os.clock() < reloadEnd
	if reloading then
		cf = cf * CFrame.new(0, -0.35, 0) * CFrame.Angles(0.7, 0, 0.4)
	end
	local equipping = os.clock() < equipEnd
	if equipping then
		cf = cf * CFrame.new(0, -0.6, 0)
	end
	body.CFrame = cf
	hand.CFrame = cf * CFrame.new(0, -0.18, body.Size.Z / 2 - 0.35)
	viewmodel:FindFirstChild("Body"):FindFirstChildOfClass("PointLight").Brightness = math.max(0, kick * 8 - 2)
	local showVm = not scoped and alive()
	for _, p in viewmodel:GetChildren() do
		(p :: BasePart).LocalTransparencyModifier = showVm and 0 or 1
	end
end

-- ---------------------------------------------------------------- tracers
local function tracer(from: Vector3, to: Vector3, mine: boolean)
	local dist = (to - from).Magnitude
	if dist < 1 then
		return
	end
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CastShadow = false
	p.Material = Enum.Material.Neon
	p.Color = mine and Color3.fromRGB(255, 230, 160) or Color3.fromRGB(255, 180, 120)
	p.Size = Vector3.new(0.06, 0.06, dist)
	p.CFrame = CFrame.lookAt((from + to) / 2, to)
	p.Transparency = 0.2
	p.Parent = workspace
	TweenService:Create(p, TweenInfo.new(0.12), { Transparency = 1 }):Play()
	task.delay(0.15, function()
		p:Destroy()
	end)
end

local function impact(pos: Vector3, normal: Vector3)
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.Size = Vector3.new(0.25, 0.25, 0.05)
	p.Color = Color3.fromRGB(40, 40, 40)
	p.CFrame = CFrame.lookAt(pos + normal * 0.02, pos + normal)
	p.Parent = workspace
	task.delay(8, function()
		p:Destroy()
	end)
end

-- ---------------------------------------------------------------- shooting
local rayParams = RaycastParams.new()
rayParams.FilterType = Enum.RaycastFilterType.Exclude

local function spreadFor(w): number
	local h = hum()
	local s = w.spread or 0
	if scoped and w.scopedSpread then
		s = w.scopedSpread
	end
	if h then
		local speed = (h.RootPart and h.RootPart.AssemblyLinearVelocity * Vector3.new(1, 0, 1) or Vector3.zero).Magnitude
		s += (w.moveSpread or 0) * math.clamp(speed / Config.RUN_SPEED, 0, 1)
		if h.FloorMaterial == Enum.Material.Air then
			s += w.airSpread or 0
		end
	end
	if crouching then
		s *= 0.8
	end
	return s + bloom
end

local function randomCone(dir: Vector3, angle: number): Vector3
	if angle <= 0 then
		return dir
	end
	local r = angle * math.sqrt(math.random())
	local theta = math.random() * math.pi * 2
	local cf = CFrame.lookAt(Vector3.zero, dir)
	local off = cf:VectorToWorldSpace(Vector3.new(math.cos(theta) * math.tan(r), math.sin(theta) * math.tan(r), -1))
	return off.Unit
end

local function fire(heavy: boolean?)
	local id = currentId()
	if not id or not alive() or Hud.buyOpen() then
		return
	end
	if workspace:GetAttribute("Phase") == "buy" or workspace:GetAttribute("Phase") == "waiting" then
		return
	end
	local w = Weapons[id]
	local t = os.clock()
	if t < equipEnd or t < reloadEnd then
		return
	end
	if heavy then
		if t < heavyCool then
			return
		end
		heavyCool = t + w.heavyCool
		nextShot = t + w.heavyCool * 0.6
	else
		if t < nextShot then
			return
		end
		nextShot = t + 60 / w.rpm
	end
	local ammo = loadout.ammo[id]
	if not w.melee then
		if not ammo or ammo.mag <= 0 then
			return
		end
		ammo.mag -= 1
	end

	rayParams.FilterDescendantsInstances = { player.Character, camera }
	local origin = camera.CFrame.Position
	local look = camera.CFrame.LookVector
	local shots = {}
	local pellets = w.pellets or 1
	local spread = w.melee and 0 or spreadFor(w)
	local range = w.melee and ((heavy and w.heavyRange or w.range) * M + 1) or 1500
	for _ = 1, pellets do
		local dir = randomCone(look, spread)
		local result = workspace:Raycast(origin, dir * range, rayParams)
		local endPos = result and result.Position or (origin + dir * range)
		local hitPart = result and result.Instance
		table.insert(shots, { part = hitPart, pos = endPos })
		if not w.melee then
			local muzzle = viewmodel and (viewmodel:FindFirstChild("Body") :: BasePart).CFrame * CFrame.new(0, 0.1, -1) or CFrame.new(origin)
			tracer(muzzle.Position, endPos, true)
			local hitModel = result and result.Instance:FindFirstAncestorOfClass("Model")
			if result and not (hitModel and hitModel:FindFirstChildOfClass("Humanoid")) then
				impact(result.Position, result.Normal)
			end
		end
	end
	Remotes.Fire:FireServer(id, origin, shots, heavy == true)

	if w.melee then
		swing = 1
		swingDir = -swingDir
		return
	end
	-- recoil: kick the camera up (and a little sideways), spray gets wider
	kick = 1
	recoilShots += 1
	local climb = recoilShots <= (w.vCap or 4) and (w.vKick or 0.01) or (w.vKick or 0.01) * 0.25
	local side = (math.random() * 2 - 1) * (w.hKick or 0)
	if scoped then
		climb *= 0.6
	end
	camera.CFrame *= CFrame.Angles(climb, side, 0)
	bloom = math.min(bloom + (w.bloom or 0), 0.08)
	if ammo and ammo.mag <= 0 then
		task.defer(function()
			Remotes.Reload:FireServer()
		end)
		reloadEnd = os.clock() + w.reload
	end
end

local function setScope(on: boolean)
	local id = currentId()
	local w = id and Weapons[id]
	if on and not (w and w.scope) then
		on = false
	end
	scoped = on
	TweenService:Create(camera, TweenInfo.new(0.12), { FieldOfView = on and (w.zoomFov or 40) * 0.8 or BASE_FOV }):Play()
	Hud.showCrosshair(not on)
end

local function equip(slot: string)
	if slot == "primary" and not loadout.primary then
		return
	end
	if loadout.slot == slot then
		return
	end
	loadout.slot = slot
	held = currentId() or "pip"
	setScope(false)
	reloadEnd = 0
	burstLeft = 0
	recoilShots = 0
	local w = Weapons[held]
	equipEnd = os.clock() + (w.equip or 0.5)
	buildViewmodel(held)
	Remotes.Equip:FireServer(slot)
end

local function reload()
	local id = currentId()
	if not id then
		return
	end
	local w = Weapons[id]
	local ammo = loadout.ammo[id]
	if w.melee or not ammo or ammo.mag >= w.mag or ammo.reserve <= 0 or os.clock() < reloadEnd then
		return
	end
	setScope(false)
	reloadEnd = os.clock() + w.reload
	Remotes.Reload:FireServer()
end

-- ---------------------------------------------------------------- input
local function updateSpeed()
	local h = hum()
	if not h then
		return
	end
	local id = currentId()
	local mul = id and Weapons[id].speedMul or 1
	local base = crouching and Config.CROUCH_SPEED or (walking and Config.WALK_SPEED or Config.RUN_SPEED)
	if scoped then
		base = math.min(base, Config.WALK_SPEED)
	end
	if workspace:GetAttribute("Phase") == "waiting" then
		base = Config.RUN_SPEED
	end
	h.WalkSpeed = base * mul
	h.CameraOffset = h.CameraOffset:Lerp(Vector3.new(0, crouching and -1.6 or 0, 0), 0.25)
end

UserInputService.InputBegan:Connect(function(input, processed)
	if processed and input.UserInputType ~= Enum.UserInputType.MouseButton1 then
		return
	end
	local key = input.KeyCode
	if input.UserInputType == Enum.UserInputType.MouseButton1 then
		if Hud.buyOpen() then
			return
		end
		triggerDown = true
		local id = currentId()
		local w = id and Weapons[id]
		if w and w.burst then
			burstLeft = w.burst
		end
		fire(false)
	elseif input.UserInputType == Enum.UserInputType.MouseButton2 then
		local id = currentId()
		if id == "knife" then
			fire(true)
		else
			setScope(not scoped)
		end
	elseif key == Enum.KeyCode.One then
		equip("primary")
	elseif key == Enum.KeyCode.Two then
		equip("secondary")
	elseif key == Enum.KeyCode.Three then
		equip("melee")
	elseif key == Enum.KeyCode.R then
		reload()
	elseif key == Enum.KeyCode.B then
		Hud.toggleBuy()
	elseif key == Enum.KeyCode.Tab then
		Hud.showBoard(true)
	elseif key == Enum.KeyCode.LeftShift then
		walking = true
	elseif key == Enum.KeyCode.LeftControl or key == Enum.KeyCode.C then
		crouching = true
	elseif key == Enum.KeyCode.F then
		local action = player:GetAttribute("Side") == "ATK" and "plant" or "defuse"
		Remotes.Action:FireServer(action)
	end
end)

UserInputService.InputEnded:Connect(function(input)
	local key = input.KeyCode
	if input.UserInputType == Enum.UserInputType.MouseButton1 then
		triggerDown = false
		recoilShots = 0
	elseif key == Enum.KeyCode.Tab then
		Hud.showBoard(false)
	elseif key == Enum.KeyCode.LeftShift then
		walking = false
	elseif key == Enum.KeyCode.LeftControl or key == Enum.KeyCode.C then
		crouching = false
	elseif key == Enum.KeyCode.F then
		Remotes.Action:FireServer(nil)
	end
end)

-- ---------------------------------------------------------------- server updates
Remotes.Loadout.OnClientEvent:Connect(function(data)
	local changed = data.primary ~= loadout.primary or data.secondary ~= loadout.secondary or data.slot ~= loadout.slot
	loadout.primary = data.primary
	loadout.secondary = data.secondary
	loadout.slot = data.slot
	loadout.ammo = data.ammo
	reloadEnd = 0
	if changed or not viewmodel then
		held = currentId() or "pip"
		buildViewmodel(held)
		setScope(false)
	end
end)

-- everyone else's shots
Remotes.Effect.OnClientEvent:Connect(function(info)
	if info.shooter == player or Weapons[info.weapon].melee then
		return
	end
	for _, pos in info.ends do
		tracer(info.origin, pos, false)
	end
end)

player.CharacterAdded:Connect(function()
	scoped = false
	camera.FieldOfView = BASE_FOV
	Hud.showCrosshair(true)
	crouching, walking = false, false
end)

-- ---------------------------------------------------------------- per frame
RunService.RenderStepped:Connect(function(dt)
	local id = currentId()
	local w = id and Weapons[id]
	-- automatic fire and bursts
	if w and alive() then
		if triggerDown and w.auto and not w.burst then
			fire(false)
		elseif burstLeft > 0 and os.clock() >= nextShot then
			burstLeft -= 1
			fire(false)
			if burstLeft == 0 then
				nextShot = os.clock() + (w.burstGap or 0.25)
			end
		end
	end
	bloom = math.max(0, bloom - dt * 0.12)
	updateSpeed()
	updateViewmodel(dt)

	-- HUD: ammo, crosshair size, hints
	if w then
		local ammo = loadout.ammo[id]
		Hud.setAmmo(id, ammo and ammo.mag, ammo and ammo.reserve, os.clock() < reloadEnd)
		if not w.melee then
			local gapPx = math.tan(spreadFor(w)) * (camera.ViewportSize.Y / 2) / math.tan(math.rad(camera.FieldOfView / 2))
			Hud.setSpread(4 + gapPx)
		else
			Hud.setSpread(4)
		end
	end
	local phase = workspace:GetAttribute("Phase")
	if not alive() and phase ~= "waiting" then
		Hud.setHint("You're dead · wait for the next round")
	elseif player:GetAttribute("HasCore") then
		Hud.setHint("You have the Core · hold F on site A or B to plant")
	elseif workspace:GetAttribute("CorePlanted") and player:GetAttribute("Side") == "DEF" then
		Hud.setHint("The Core is planted at " .. tostring(workspace:GetAttribute("CoreSite")) .. " · hold F next to it to defuse")
	elseif phase == "buy" then
		Hud.setHint("Press B to buy weapons and shields")
	else
		Hud.setHint("")
	end
end)

camera.FieldOfView = BASE_FOV
buildViewmodel(held)

return {}
