-- All 2D UI, built in code: top score bar, health/shield, ammo, credits, crosshair, kill feed,
-- banners, plant/defuse progress, hit markers, buy menu (B), scoreboard (Tab) and match results.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

local Shared = ReplicatedStorage.Shared
local Weapons = require(Shared.Weapons)
local Ranks = require(Shared.Ranks)

local player = Players.LocalPlayer
local Remotes = ReplicatedStorage:WaitForChild("Remotes")

local GOLD = Color3.fromRGB(255, 210, 63)
local BLUE = Color3.fromRGB(46, 230, 214)
local RED = Color3.fromRGB(255, 72, 90)
local DARK = Color3.fromRGB(10, 14, 20)
local WHITE = Color3.fromRGB(238, 242, 245)

local Hud = {}

local function make(class: string, props: { [string]: any }, children: { Instance }?): any
	local obj = Instance.new(class)
	for k, v in props do
		if k ~= "Parent" then
			(obj :: any)[k] = v
		end
	end
	for _, child in children or {} do
		child.Parent = obj
	end
	if props.Parent then
		obj.Parent = props.Parent
	end
	return obj
end

local function label(props: { [string]: any }): TextLabel
	local defaults = {
		BackgroundTransparency = 1, TextColor3 = WHITE, Font = Enum.Font.GothamBold, TextScaled = false, TextSize = 18,
		TextStrokeTransparency = 0.6,
	}
	for k, v in props do
		defaults[k] = v
	end
	return make("TextLabel", defaults)
end

local function corner(r: number?)
	return make("UICorner", { CornerRadius = UDim.new(0, r or 4) })
end

local gui = make("ScreenGui", {
	Name = "ShootahHud", ResetOnSpawn = false, IgnoreGuiInset = true, ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
	Parent = player:WaitForChild("PlayerGui"),
})
Hud.gui = gui

local function teamColor(teamName: string?): Color3
	return teamName == "Red" and RED or BLUE
end

-- ---------------------------------------------------------------- top bar
local top = make("Frame", { Size = UDim2.fromOffset(360, 64), Position = UDim2.new(0.5, -180, 0, 8), BackgroundTransparency = 1, Parent = gui })
local scoreBlue = label({ Size = UDim2.fromOffset(70, 44), Position = UDim2.fromOffset(40, 0), Text = "0", TextSize = 34, TextColor3 = BLUE, Font = Enum.Font.GothamBlack, Parent = top })
local timer = label({ Size = UDim2.fromOffset(120, 44), Position = UDim2.fromOffset(120, 0), Text = "0:00", TextSize = 30, Font = Enum.Font.GothamBlack, BackgroundTransparency = 0.35, BackgroundColor3 = DARK, Parent = top })
corner(6).Parent = timer
local scoreRed = label({ Size = UDim2.fromOffset(70, 44), Position = UDim2.fromOffset(250, 0), Text = "0", TextSize = 34, TextColor3 = RED, Font = Enum.Font.GothamBlack, Parent = top })
local roundLabel = label({ Size = UDim2.new(1, 0, 0, 18), Position = UDim2.fromOffset(0, 46), Text = "", TextSize = 13, Parent = top })
local sideLabel = label({ Size = UDim2.fromOffset(300, 22), Position = UDim2.fromOffset(16, 12), Text = "", TextSize = 16, TextXAlignment = Enum.TextXAlignment.Left, Font = Enum.Font.GothamBlack, Parent = gui })
local mapLabel = label({ Size = UDim2.fromOffset(300, 18), Position = UDim2.fromOffset(16, 34), Text = "", TextSize = 13, TextXAlignment = Enum.TextXAlignment.Left, TextTransparency = 0.3, Parent = gui })

-- ---------------------------------------------------------------- bottom left: health, shield, credits
local vitals = make("Frame", { Size = UDim2.fromOffset(260, 70), Position = UDim2.new(0, 16, 1, -86), BackgroundColor3 = DARK, BackgroundTransparency = 0.35, Parent = gui }, { corner(6) })
local healthText = label({ Size = UDim2.fromOffset(110, 44), Position = UDim2.fromOffset(10, 4), Text = "100", TextSize = 40, Font = Enum.Font.GothamBlack, TextXAlignment = Enum.TextXAlignment.Left, Parent = vitals })
label({ Size = UDim2.fromOffset(110, 14), Position = UDim2.fromOffset(12, 48), Text = "HEALTH", TextSize = 11, TextTransparency = 0.4, TextXAlignment = Enum.TextXAlignment.Left, Parent = vitals })
local shieldText = label({ Size = UDim2.fromOffset(60, 30), Position = UDim2.fromOffset(120, 12), Text = "0", TextSize = 26, TextColor3 = Color3.fromRGB(140, 200, 255), Font = Enum.Font.GothamBlack, TextXAlignment = Enum.TextXAlignment.Left, Parent = vitals })
label({ Size = UDim2.fromOffset(60, 14), Position = UDim2.fromOffset(120, 48), Text = "SHIELD", TextSize = 11, TextTransparency = 0.4, TextXAlignment = Enum.TextXAlignment.Left, Parent = vitals })
local creditsText = label({ Size = UDim2.fromOffset(80, 30), Position = UDim2.fromOffset(176, 12), Text = "¤0", TextSize = 20, TextColor3 = GOLD, Font = Enum.Font.GothamBlack, TextXAlignment = Enum.TextXAlignment.Right, Parent = vitals })
label({ Size = UDim2.fromOffset(80, 14), Position = UDim2.fromOffset(176, 48), Text = "CREDITS", TextSize = 11, TextTransparency = 0.4, TextXAlignment = Enum.TextXAlignment.Right, Parent = vitals })

-- ---------------------------------------------------------------- bottom right: weapon + ammo
local ammoBox = make("Frame", { Size = UDim2.fromOffset(220, 70), Position = UDim2.new(1, -236, 1, -86), BackgroundColor3 = DARK, BackgroundTransparency = 0.35, Parent = gui }, { corner(6) })
local ammoText = label({ Size = UDim2.fromOffset(200, 40), Position = UDim2.fromOffset(10, 4), Text = "", TextSize = 34, Font = Enum.Font.GothamBlack, TextXAlignment = Enum.TextXAlignment.Right, Parent = ammoBox })
local weaponText = label({ Size = UDim2.fromOffset(200, 16), Position = UDim2.fromOffset(10, 46), Text = "", TextSize = 13, TextTransparency = 0.2, TextXAlignment = Enum.TextXAlignment.Right, Parent = ammoBox })

-- ---------------------------------------------------------------- crosshair + hit marker
local cross = make("Frame", { Size = UDim2.fromOffset(40, 40), Position = UDim2.new(0.5, -20, 0.5, -20), BackgroundTransparency = 1, Parent = gui })
local crossBars = {}
for i, d in { Vector2.new(1, 0), Vector2.new(-1, 0), Vector2.new(0, 1), Vector2.new(0, -1) } do
	crossBars[i] = { dir = d, bar = make("Frame", { BackgroundColor3 = Color3.fromRGB(0, 255, 156), BorderSizePixel = 0, Parent = cross }) }
end
make("Frame", { Size = UDim2.fromOffset(2, 2), Position = UDim2.new(0.5, -1, 0.5, -1), BackgroundColor3 = Color3.fromRGB(0, 255, 156), BorderSizePixel = 0, Parent = cross })
local function layoutCrosshair(gap: number)
	for _, b in crossBars do
		local len, thick = 7, 2
		local horizontal = b.dir.X ~= 0
		b.bar.Size = horizontal and UDim2.fromOffset(len, thick) or UDim2.fromOffset(thick, len)
		local off = b.dir * (gap + len / 2)
		b.bar.Position = UDim2.new(0.5, off.X - (horizontal and len or thick) / 2, 0.5, off.Y - (horizontal and thick or len) / 2)
	end
end
layoutCrosshair(4)
function Hud.setSpread(gap: number)
	layoutCrosshair(math.clamp(gap, 3, 60))
end
function Hud.showCrosshair(show: boolean)
	cross.Visible = show
end

local hitMark = make("Frame", { Size = UDim2.fromOffset(22, 22), Position = UDim2.new(0.5, -11, 0.5, -11), BackgroundTransparency = 1, Visible = false, Parent = gui })
for _, rot in { 45, -45 } do
	make("Frame", { Size = UDim2.fromOffset(22, 2), Position = UDim2.new(0, 0, 0.5, -1), Rotation = rot, BackgroundColor3 = WHITE, BorderSizePixel = 0, Parent = hitMark })
end
local hitTime = 0

-- ---------------------------------------------------------------- kill feed
local feed = make("Frame", { Size = UDim2.fromOffset(360, 200), Position = UDim2.new(1, -376, 0, 70), BackgroundTransparency = 1, Parent = gui }, {
	make("UIListLayout", { Padding = UDim.new(0, 4), HorizontalAlignment = Enum.HorizontalAlignment.Right, SortOrder = Enum.SortOrder.LayoutOrder }),
})
local feedOrder = 0

-- ---------------------------------------------------------------- banners + action bar + messages
local banner = make("Frame", { Size = UDim2.fromOffset(600, 90), Position = UDim2.new(0.5, -300, 0.22, 0), BackgroundTransparency = 1, Visible = false, Parent = gui })
local bannerTitle = label({ Size = UDim2.new(1, 0, 0, 56), Text = "", TextSize = 48, Font = Enum.Font.GothamBlack, TextStrokeTransparency = 0.3, Parent = banner })
local bannerSub = label({ Size = UDim2.new(1, 0, 0, 24), Position = UDim2.fromOffset(0, 58), Text = "", TextSize = 20, Parent = banner })
local bannerUntil = 0

local actionBar = make("Frame", { Size = UDim2.fromOffset(260, 34), Position = UDim2.new(0.5, -130, 0.62, 0), BackgroundColor3 = DARK, BackgroundTransparency = 0.3, Visible = false, Parent = gui }, { corner(4) })
local actionFill = make("Frame", { Size = UDim2.fromScale(0, 1), BackgroundColor3 = GOLD, BorderSizePixel = 0, Parent = actionBar }, { corner(4) })
local actionText = label({ Size = UDim2.fromScale(1, 1), Text = "", TextSize = 14, Font = Enum.Font.GothamBlack, Parent = actionBar })

local hint = label({ Size = UDim2.fromOffset(600, 24), Position = UDim2.new(0.5, -300, 1, -120), Text = "", TextSize = 16, TextColor3 = GOLD, Parent = gui })

local hurtFlash = make("Frame", { Size = UDim2.fromScale(1, 1), BackgroundColor3 = Color3.fromRGB(255, 0, 0), BackgroundTransparency = 1, Parent = gui })

function Hud.banner(info)
	bannerTitle.Text = info.title or ""
	bannerSub.Text = info.sub or ""
	local color = WHITE
	if info.kind == "ace" then
		color = GOLD
	elseif info.kind == "warn" then
		color = RED
	elseif info.kind == "round" then
		color = info.winTeam == 2 and RED or BLUE
	end
	bannerTitle.TextColor3 = color
	banner.Visible = true
	bannerUntil = os.clock() + (info.time or 2.5)
	bannerTitle.TextSize = info.kind == "ace" and 90 or 48
end

function Hud.hit(info)
	hitMark.Visible = true
	hitTime = os.clock()
	local color = info.kill and RED or (info.head and GOLD or WHITE)
	for _, f in hitMark:GetChildren() do
		(f :: Frame).BackgroundColor3 = color
	end
	-- floating damage number
	local n = label({
		Size = UDim2.fromOffset(80, 24), Position = UDim2.new(0.5, 14 + math.random(-6, 6), 0.5, -36),
		Text = tostring(info.damage), TextSize = info.head and 22 or 18, TextColor3 = color, Font = Enum.Font.GothamBlack, Parent = gui,
	})
	TweenService:Create(n, TweenInfo.new(0.7), { Position = n.Position - UDim2.fromOffset(0, 30), TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
	task.delay(0.75, function()
		n:Destroy()
	end)
end

function Hud.hurt(_info)
	hurtFlash.BackgroundTransparency = 0.7
	TweenService:Create(hurtFlash, TweenInfo.new(0.4), { BackgroundTransparency = 1 }):Play()
end

function Hud.feed(info)
	feedOrder += 1
	local myName = player.DisplayName
	local involved = info.killer == myName or info.victim == myName
	local row = make("Frame", {
		Size = UDim2.fromOffset(360, 26), BackgroundColor3 = involved and Color3.fromRGB(60, 50, 20) or DARK,
		BackgroundTransparency = 0.3, LayoutOrder = feedOrder, Parent = feed,
	}, { corner(3) })
	local weaponName = info.weapon and Weapons[info.weapon] and Weapons[info.weapon].name or ""
	local text = string.format(
		'<font color="#%s">%s</font>  <font color="#cccccc">[%s%s]</font>  <font color="#%s">%s</font>',
		(info.killerTeam == 2 and RED or BLUE):ToHex(), info.killer or "",
		weaponName, info.head and " ◎" or "",
		(info.victimTeam == 2 and RED or BLUE):ToHex(), info.victim or ""
	)
	if info.assists and #info.assists > 0 then
		text ..= '  <font color="#999999">+ ' .. table.concat(info.assists, ", ") .. "</font>"
	end
	label({ Size = UDim2.new(1, -12, 1, 0), Position = UDim2.fromOffset(6, 0), Text = text, RichText = true, TextSize = 14, TextXAlignment = Enum.TextXAlignment.Right, Parent = row })
	task.delay(6, function()
		row:Destroy()
	end)
end

function Hud.setAmmo(weaponId: string?, mag: number?, reserve: number?, reloading: boolean?)
	local w = weaponId and Weapons[weaponId]
	weaponText.Text = w and string.upper(w.name) or ""
	if not w or w.melee then
		ammoText.Text = "—"
	elseif reloading then
		ammoText.Text = "RELOADING"
		ammoText.TextSize = 22
		return
	else
		ammoText.Text = string.format("%d / %d", mag or 0, reserve or 0)
	end
	ammoText.TextSize = 34
	ammoText.TextColor3 = (mag or 0) == 0 and RED or WHITE
end

function Hud.setHint(text: string)
	hint.Text = text
end

-- ---------------------------------------------------------------- buy menu
local buyOpen = false
local buyFrame = make("Frame", {
	Size = UDim2.fromOffset(760, 440), Position = UDim2.new(0.5, -380, 0.5, -220), BackgroundColor3 = DARK,
	BackgroundTransparency = 0.08, Visible = false, Parent = gui,
}, { corner(8) })
-- a modal button frees the mouse from first-person lock while the menu is open
local modal = make("TextButton", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, Text = "", Modal = true, AutoButtonColor = false, Parent = buyFrame })
modal.ZIndex = 0
label({ Size = UDim2.fromOffset(300, 30), Position = UDim2.fromOffset(18, 10), Text = "BUY", TextSize = 24, Font = Enum.Font.GothamBlack, TextXAlignment = Enum.TextXAlignment.Left, Parent = buyFrame })
local buyCredits = label({ Size = UDim2.fromOffset(200, 30), Position = UDim2.new(1, -218, 0, 10), Text = "", TextSize = 22, TextColor3 = GOLD, Font = Enum.Font.GothamBlack, TextXAlignment = Enum.TextXAlignment.Right, Parent = buyFrame })
local buyMsg = label({ Size = UDim2.new(1, -36, 0, 20), Position = UDim2.new(0, 18, 1, -30), Text = "B or Esc to close · you can only buy in spawn during the buy phase", TextSize = 13, TextTransparency = 0.3, Parent = buyFrame })

local CATEGORIES = { "Sidearm", "SMG", "Shotgun", "Rifle", "Sniper", "Heavy" }
local buyButtons = {}
local columns = make("Frame", { Size = UDim2.new(1, -36, 1, -90), Position = UDim2.fromOffset(18, 48), BackgroundTransparency = 1, Parent = buyFrame }, {
	make("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }),
})
local function addColumn(title: string, items: { any }, order: number)
	local col = make("Frame", { Size = UDim2.new(1 / 7, -7, 1, 0), BackgroundTransparency = 1, LayoutOrder = order, Parent = columns }, {
		make("UIListLayout", { Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	label({ Size = UDim2.new(1, 0, 0, 18), Text = string.upper(title), TextSize = 12, TextTransparency = 0.3, LayoutOrder = 0, Parent = col })
	for i, item in items do
		local b = make("TextButton", {
			Size = UDim2.new(1, 0, 0, 58), BackgroundColor3 = Color3.fromRGB(30, 36, 46), AutoButtonColor = true,
			Text = "", LayoutOrder = i, Parent = col,
		}, { corner(4) })
		label({ Size = UDim2.new(1, -8, 0, 26), Position = UDim2.fromOffset(4, 6), Text = item.name, TextSize = 13, TextWrapped = true, Parent = b })
		label({ Size = UDim2.new(1, -8, 0, 18), Position = UDim2.fromOffset(4, 34), Text = item.price == 0 and "FREE" or ("¤" .. item.price), TextSize = 14, TextColor3 = GOLD, Font = Enum.Font.GothamBlack, Parent = b })
		b.MouseButton1Click:Connect(function()
			local ok, msg = Remotes.Buy:InvokeServer(item.id)
			buyMsg.Text = ok and ("Bought " .. msg) or msg
			buyMsg.TextColor3 = ok and Color3.fromRGB(120, 255, 160) or RED
		end)
		table.insert(buyButtons, { button = b, price = item.price })
	end
end
for i, cat in CATEGORIES do
	local items = {}
	for _, id in Weapons.ORDER do
		local w = Weapons[id]
		if w.category == cat then
			table.insert(items, w)
		end
	end
	table.sort(items, function(a, b)
		return a.price < b.price
	end)
	addColumn(cat, items, i)
end
addColumn("Shields", { Weapons.SHIELDS.light, Weapons.SHIELDS.heavy }, 7)

local function refreshBuy()
	local credits = player:GetAttribute("Credits") or 0
	buyCredits.Text = "¤ " .. credits
	for _, b in buyButtons do
		b.button.BackgroundTransparency = b.price > credits and 0.6 or 0
	end
end

function Hud.toggleBuy(force: boolean?)
	if force ~= nil then
		buyOpen = force
	else
		buyOpen = not buyOpen
	end
	if buyOpen and workspace:GetAttribute("Phase") ~= "buy" then
		buyOpen = false
	end
	buyFrame.Visible = buyOpen
	refreshBuy()
	return buyOpen
end
function Hud.buyOpen()
	return buyOpen
end

-- ---------------------------------------------------------------- scoreboard (Tab)
local board = make("Frame", { Size = UDim2.fromOffset(620, 380), Position = UDim2.new(0.5, -310, 0.5, -190), BackgroundColor3 = DARK, BackgroundTransparency = 0.12, Visible = false, Parent = gui }, { corner(8) })
local boardList = make("Frame", { Size = UDim2.new(1, -24, 1, -24), Position = UDim2.fromOffset(12, 12), BackgroundTransparency = 1, Parent = board }, {
	make("UIListLayout", { Padding = UDim.new(0, 3), SortOrder = Enum.SortOrder.LayoutOrder }),
})
local function boardRow(text: string, color: Color3, order: number, bold: boolean?)
	local row = make("Frame", { Size = UDim2.new(1, 0, 0, 26), BackgroundColor3 = color, BackgroundTransparency = bold and 1 or 0.75, LayoutOrder = order, Parent = boardList }, { corner(3) })
	label({ Size = UDim2.new(1, -16, 1, 0), Position = UDim2.fromOffset(8, 0), Text = text, RichText = true, TextSize = bold and 13 or 15, TextXAlignment = Enum.TextXAlignment.Left, Font = Enum.Font.Code, Parent = row })
end
function Hud.showBoard(show: boolean)
	board.Visible = show
	if not show then
		return
	end
	for _, ch in boardList:GetChildren() do
		if ch:IsA("Frame") then
			ch:Destroy()
		end
	end
	local order = 0
	for _, teamName in { "Blue", "Red" } do
		order += 1
		boardRow(string.format("%-18s %5s %5s %5s %7s %s", teamName:upper(), "K", "D", "A", "CREDITS", "RANK"), teamColor(teamName), order, true)
		for _, p in Players:GetPlayers() do
			if p.Team and p.Team.Name == teamName then
				order += 1
				local rank = Ranks.rankOf(p:GetAttribute("Saved_rr") or 0)
				local dead = p:GetAttribute("Alive") == false
				boardRow(string.format("%-18s %5d %5d %5d %7s %s", string.sub(p.DisplayName, 1, 18) .. (dead and " ✕" or ""),
					p:GetAttribute("Kills") or 0, p:GetAttribute("Deaths") or 0, p:GetAttribute("Assists") or 0,
					"¤" .. (p:GetAttribute("Credits") or 0), rank.name), teamColor(teamName), order)
			end
		end
	end
end

-- ---------------------------------------------------------------- match results
local results = make("Frame", { Size = UDim2.fromOffset(520, 300), Position = UDim2.new(0.5, -260, 0.5, -150), BackgroundColor3 = DARK, BackgroundTransparency = 0.05, Visible = false, Parent = gui }, { corner(10) })
local resTitle = label({ Size = UDim2.new(1, 0, 0, 60), Position = UDim2.fromOffset(0, 16), Text = "", TextSize = 52, Font = Enum.Font.GothamBlack, Parent = results })
local resScore = label({ Size = UDim2.new(1, 0, 0, 30), Position = UDim2.fromOffset(0, 80), Text = "", TextSize = 26, Parent = results })
local resRank = label({ Size = UDim2.new(1, 0, 0, 30), Position = UDim2.fromOffset(0, 130), Text = "", TextSize = 22, Parent = results })
local resCoins = label({ Size = UDim2.new(1, 0, 0, 30), Position = UDim2.fromOffset(0, 170), Text = "", TextSize = 20, TextColor3 = GOLD, Parent = results })
label({ Size = UDim2.new(1, 0, 0, 20), Position = UDim2.new(0, 0, 1, -36), Text = "Next match starts soon", TextSize = 14, TextTransparency = 0.4, Parent = results })
function Hud.results(info)
	if info.table then
		return -- the full table is shown on the scoreboard (Tab)
	end
	resTitle.Text = info.draw and "DRAW" or (info.won and "VICTORY" or "DEFEAT")
	resTitle.TextColor3 = info.draw and WHITE or (info.won and Color3.fromRGB(120, 255, 160) or RED)
	resScore.Text = string.format("%d  —  %d", info.score[info.myTeam], info.score[3 - info.myTeam])
	local rr = player:GetAttribute("Saved_rr") or 0
	local rank = Ranks.rankOf(rr)
	resRank.Text = string.format("%s   %s%d RR", rank.name, info.rrDelta >= 0 and "+" or "", info.rrDelta)
	resRank.TextColor3 = rank.color
	resCoins.Text = "+" .. info.coins .. " coins"
	results.Visible = true
	task.delay(11, function()
		results.Visible = false
	end)
end

-- ---------------------------------------------------------------- per-frame updates
local function fmtTime(t: number): string
	t = math.max(0, math.ceil(t))
	return string.format("%d:%02d", t // 60, t % 60)
end

RunService.RenderStepped:Connect(function()
	local phase = workspace:GetAttribute("Phase") or "waiting"
	local nowT = workspace:GetServerTimeNow()
	local planted = workspace:GetAttribute("CorePlanted")
	if phase == "waiting" then
		timer.Text = "—"
		roundLabel.Text = "WAITING FOR PLAYERS"
	else
		local finish = planted and (workspace:GetAttribute("CoreExplodeAt") or 0) or (workspace:GetAttribute("PhaseEnd") or 0)
		timer.Text = fmtTime(finish - nowT)
		timer.TextColor3 = planted and RED or (phase == "buy" and GOLD or WHITE)
		roundLabel.Text = phase == "buy" and "BUY PHASE · press B" or ("ROUND " .. (workspace:GetAttribute("Round") or 0) .. " · first to " .. (workspace:GetAttribute("WinRounds") or 7))
	end
	scoreBlue.Text = tostring(workspace:GetAttribute("ScoreBlue") or 0)
	scoreRed.Text = tostring(workspace:GetAttribute("ScoreRed") or 0)
	local myTeam = player.Team and player.Team.Name or "Blue"
	local attacking = player:GetAttribute("Side") == "ATK"
	sideLabel.Text = (attacking and "ATTACKING" or "DEFENDING") .. " · " .. string.upper(myTeam)
	sideLabel.TextColor3 = teamColor(myTeam)
	mapLabel.Text = workspace:GetAttribute("MapName") or ""

	local char = player.Character
	local hum = char and char:FindFirstChildOfClass("Humanoid")
	healthText.Text = tostring(hum and math.max(0, math.ceil(hum.Health)) or 0)
	healthText.TextColor3 = hum and hum.Health < 35 and RED or WHITE
	shieldText.Text = tostring(player:GetAttribute("Shield") or 0)
	creditsText.Text = "¤" .. (player:GetAttribute("Credits") or 0)
	if buyOpen then
		refreshBuy()
		if phase ~= "buy" then
			Hud.toggleBuy(false)
		end
	end

	-- plant / defuse progress
	local progress = player:GetAttribute("ActionProgress") or 0
	actionBar.Visible = progress > 0
	actionFill.Size = UDim2.fromScale(math.clamp(progress, 0, 1), 1)
	actionText.Text = attacking and "PLANTING CORE" or "DEFUSING CORE"

	if os.clock() > bannerUntil then
		banner.Visible = false
	end
	if hitMark.Visible and os.clock() - hitTime > 0.15 then
		hitMark.Visible = false
	end
	if board.Visible then
		Hud.showBoard(true)
	end
end)

Remotes.Feed.OnClientEvent:Connect(Hud.feed)
Remotes.Banner.OnClientEvent:Connect(Hud.banner)
Remotes.Hit.OnClientEvent:Connect(Hud.hit)
Remotes.Hurt.OnClientEvent:Connect(Hud.hurt)
Remotes.Results.OnClientEvent:Connect(Hud.results)

return Hud
