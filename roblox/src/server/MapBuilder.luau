-- Builds a map in Workspace from a text layout in Shared/Maps (same layouts as the browser game).
-- Returns the map info the match needs: sites, spawn points and spawn zones.
local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)

local CELL = Config.CELL

local THEMES = {
	neon = {
		floor = Color3.fromRGB(38, 40, 52), floorMat = Enum.Material.Asphalt,
		wall = Color3.fromRGB(52, 50, 72), wallMat = Enum.Material.Concrete,
		trim = Color3.fromRGB(255, 60, 200), trimMat = Enum.Material.Neon,
		cover = Color3.fromRGB(70, 74, 92), coverMat = Enum.Material.Metal,
		raised = Color3.fromRGB(60, 62, 80),
		clock = 0.5, ambient = Color3.fromRGB(90, 70, 130), fog = Color3.fromRGB(40, 20, 70), brightness = 1.2,
	},
	desert = {
		floor = Color3.fromRGB(214, 180, 128), floorMat = Enum.Material.Sand,
		wall = Color3.fromRGB(205, 160, 105), wallMat = Enum.Material.Sandstone,
		trim = Color3.fromRGB(150, 100, 60), trimMat = Enum.Material.Sandstone,
		cover = Color3.fromRGB(170, 130, 85), coverMat = Enum.Material.WoodPlanks,
		raised = Color3.fromRGB(190, 150, 100),
		clock = 17.4, ambient = Color3.fromRGB(150, 110, 80), fog = Color3.fromRGB(255, 190, 130), brightness = 2.6,
	},
	snow = {
		floor = Color3.fromRGB(235, 240, 248), floorMat = Enum.Material.Snow,
		wall = Color3.fromRGB(95, 110, 130), wallMat = Enum.Material.CorrodedMetal,
		trim = Color3.fromRGB(255, 200, 40), trimMat = Enum.Material.Metal,
		cover = Color3.fromRGB(60, 120, 90), coverMat = Enum.Material.DiamondPlate,
		raised = Color3.fromRGB(120, 130, 145),
		clock = 13, ambient = Color3.fromRGB(150, 160, 180), fog = Color3.fromRGB(220, 230, 245), brightness = 2.2,
	},
	jungle = {
		floor = Color3.fromRGB(90, 120, 60), floorMat = Enum.Material.Grass,
		wall = Color3.fromRGB(120, 125, 105), wallMat = Enum.Material.Cobblestone,
		trim = Color3.fromRGB(60, 100, 50), trimMat = Enum.Material.LeafyGrass,
		cover = Color3.fromRGB(110, 85, 60), coverMat = Enum.Material.Wood,
		raised = Color3.fromRGB(130, 130, 110),
		clock = 10, ambient = Color3.fromRGB(100, 130, 90), fog = Color3.fromRGB(170, 200, 160), brightness = 2,
	},
	canals = {
		floor = Color3.fromRGB(150, 140, 125), floorMat = Enum.Material.Pavement,
		wall = Color3.fromRGB(170, 95, 70), wallMat = Enum.Material.Brick,
		trim = Color3.fromRGB(235, 225, 205), trimMat = Enum.Material.Limestone,
		cover = Color3.fromRGB(120, 90, 60), coverMat = Enum.Material.WoodPlanks,
		raised = Color3.fromRGB(160, 150, 135),
		clock = 16, ambient = Color3.fromRGB(140, 130, 120), fog = Color3.fromRGB(200, 210, 220), brightness = 2.3,
	},
}

local MapBuilder = {}

local function part(parent: Instance, size: Vector3, cf: CFrame, color: Color3, material: Enum.Material, name: string?): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.Size = size
	p.CFrame = cf
	p.Color = color
	p.Material = material
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Name = name or "Part"
	p.Parent = parent
	return p
end

local function marker(parent: Instance, name: string, cf: CFrame, size: Vector3): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.Transparency = 1
	p.Size = size
	p.CFrame = cf
	p.Name = name
	p.Parent = parent
	return p
end

local function siteLabel(parent: Instance, letter: string, pos: Vector3)
	local anchor = marker(parent, "SiteLabel" .. letter, CFrame.new(pos + Vector3.new(0, 14, 0)), Vector3.new(1, 1, 1))
	local gui = Instance.new("BillboardGui")
	gui.Size = UDim2.fromOffset(80, 80)
	gui.AlwaysOnTop = false
	gui.LightInfluence = 0
	gui.MaxDistance = 400
	gui.Parent = anchor
	local t = Instance.new("TextLabel")
	t.Size = UDim2.fromScale(1, 1)
	t.BackgroundTransparency = 1
	t.Text = letter
	t.Font = Enum.Font.GothamBlack
	t.TextScaled = true
	t.TextColor3 = Color3.fromRGB(255, 210, 63)
	t.TextStrokeTransparency = 0.3
	t.Parent = gui
end

-- Builds the map with the given id (or a random one). Destroys any previous map.
function MapBuilder.build(def)
	local old = workspace:FindFirstChild("Map")
	if old then
		old:Destroy()
	end
	local theme = THEMES[def.theme] or THEMES.neon
	local rows = def.rows
	local H, W = #rows, #rows[1]
	local ox, oz = -W * CELL / 2, -H * CELL / 2

	local model = Instance.new("Model")
	model.Name = "Map"
	local geo = Instance.new("Folder")
	geo.Name = "Geometry"
	geo.Parent = model
	local markers = Instance.new("Folder")
	markers.Name = "Markers"
	markers.Parent = model

	local function at(c: number, r: number): string
		if r < 1 or r > H or c < 1 or c > W then
			return "#"
		end
		return string.sub(rows[r], c, c)
	end
	local function cellCenter(c: number, r: number): Vector3
		return Vector3.new(ox + (c - 0.5) * CELL, 0, oz + (r - 0.5) * CELL)
	end

	-- floor (one big slab) with a darker rim under the walls
	part(geo, Vector3.new(W * CELL, 2, H * CELL), CFrame.new(0, -1, 0), theme.floor, theme.floorMat, "Floor")

	-- full-height walls: merge horizontal runs into single parts
	local function wallRuns(match: (string) -> boolean, y0: number, y1: number, color: Color3, mat: Enum.Material, name: string)
		for r = 1, H do
			local c = 1
			while c <= W do
				if match(at(c, r)) then
					local c1 = c
					while c1 + 1 <= W and match(at(c1 + 1, r)) do
						c1 += 1
					end
					local len = (c1 - c + 1) * CELL
					local x = ox + (c - 1) * CELL + len / 2
					local z = oz + (r - 0.5) * CELL
					part(geo, Vector3.new(len, y1 - y0, CELL), CFrame.new(x, (y0 + y1) / 2, z), color, mat, name)
					c = c1 + 1
				else
					c += 1
				end
			end
		end
	end
	local isWall = function(ch)
		return ch == "#"
	end
	wallRuns(isWall, 0, Config.WALL_H, theme.wall, theme.wallMat, "Wall")
	-- a neon / trim strip along the wall tops
	wallRuns(isWall, Config.WALL_H, Config.WALL_H + 0.6, theme.trim, theme.trimMat, "Trim")
	-- windows: a sill and a lintel with a gap you can shoot through
	wallRuns(function(ch) return ch == "w" end, 0, 3.4, theme.wall, theme.wallMat, "WindowSill")
	wallRuns(function(ch) return ch == "w" end, 7.4, Config.WALL_H, theme.wall, theme.wallMat, "WindowTop")
	-- archways: wall above head height only
	wallRuns(function(ch) return ch == "n" end, 10, Config.WALL_H, theme.wall, theme.wallMat, "Arch")
	-- roofs over indoor floor
	wallRuns(function(ch) return ch == "," end, Config.ROOF_H, Config.ROOF_H + 1, theme.wall, theme.wallMat, "Roof")
	-- raised ground
	wallRuns(function(ch) return ch == "1" end, 0, Config.LEDGE_H, theme.raised, theme.wallMat, "Ledge")
	wallRuns(function(ch) return ch == "2" end, 0, Config.PLATFORM_H, theme.raised, theme.wallMat, "Platform")

	local siteCells = { A = {}, B = {} }
	local spawnCells = { T = {}, D = {} }

	for r = 1, H do
		for c = 1, W do
			local ch = at(c, r)
			local center = cellCenter(c, r)
			if ch == "c" or ch == "C" then
				local h = ch == "c" and Config.LOW_COVER_H or Config.TALL_COVER_H
				part(geo, Vector3.new(CELL - 2, h, CELL - 2), CFrame.new(center + Vector3.new(0, h / 2, 0)), theme.cover, theme.coverMat, "Cover")
			elseif ch == "o" then
				part(geo, Vector3.new(3.5, 14, 3.5), CFrame.new(center + Vector3.new(0, 7, 0)), theme.wall, theme.wallMat, "Pillar")
			elseif ch == "~" then
				local w = part(geo, Vector3.new(CELL, 0.4, CELL), CFrame.new(center + Vector3.new(0, 0.2, 0)), Color3.fromRGB(60, 120, 170), Enum.Material.Glass, "Water")
				w.Transparency = 0.35
				w.CanCollide = false
			elseif ch == "^" or ch == "v" or ch == "<" or ch == ">" then
				-- six steps rising toward the arrow, up to platform height
				local dir = ({ ["^"] = Vector3.new(0, 0, -1), v = Vector3.new(0, 0, 1), ["<"] = Vector3.new(-1, 0, 0), [">"] = Vector3.new(1, 0, 0) })[ch]
				local steps = 6
				local rise = Config.PLATFORM_H / steps
				local depth = CELL / steps
				for i = 1, steps do
					local h = rise * i
					local offset = dir * (-CELL / 2 + depth * (i - 0.5))
					local size = dir.X ~= 0 and Vector3.new(depth, h, CELL) or Vector3.new(CELL, h, depth)
					part(geo, size, CFrame.new(center + offset + Vector3.new(0, h / 2, 0)), theme.raised, theme.wallMat, "Step")
				end
			elseif ch == "A" or ch == "B" then
				table.insert(siteCells[ch], center)
				local tint = part(geo, Vector3.new(CELL, 0.1, CELL), CFrame.new(center + Vector3.new(0, 0.05, 0)), Color3.fromRGB(255, 210, 63), Enum.Material.SmoothPlastic, "SiteFloor")
				tint.Transparency = 0.82
				tint.CanCollide = false
				tint.CanQuery = false
			elseif ch == "T" or ch == "D" then
				table.insert(spawnCells[ch], center)
			end
		end
	end

	-- sites: bounding box of their cells (plant anywhere inside)
	local sites = {}
	for letter, cells in siteCells do
		if #cells > 0 then
			local min, max = cells[1], cells[1]
			local sum = Vector3.zero
			for _, p in cells do
				min = min:Min(p)
				max = max:Max(p)
				sum += p
			end
			min -= Vector3.new(CELL / 2, 0, CELL / 2)
			max += Vector3.new(CELL / 2, 0, CELL / 2)
			local center = sum / #cells
			sites[letter] = { min = min, max = max, center = center, cells = cells }
			siteLabel(markers, letter, center)
		end
	end

	-- spawns: spread players over the spawn cells, and keep the zone for the buy-phase barrier
	local spawns = {}
	for side, cells in spawnCells do
		local min, max = cells[1], cells[1]
		for _, p in cells do
			min = min:Min(p)
			max = max:Max(p)
		end
		spawns[side] = {
			points = cells,
			min = min - Vector3.new(CELL / 2, 0, CELL / 2),
			max = max + Vector3.new(CELL / 2, 0, CELL / 2),
		}
	end

	model.Parent = workspace

	-- lighting / mood
	Lighting.ClockTime = theme.clock
	Lighting.Ambient = theme.ambient
	Lighting.OutdoorAmbient = theme.ambient
	Lighting.Brightness = theme.brightness
	Lighting.FogColor = theme.fog
	Lighting.FogStart = 150
	Lighting.FogEnd = 900

	return {
		id = def.id,
		name = def.name,
		model = model,
		sites = sites,
		spawns = spawns,
		size = Vector3.new(W * CELL, 0, H * CELL),
	}
end

return MapBuilder
