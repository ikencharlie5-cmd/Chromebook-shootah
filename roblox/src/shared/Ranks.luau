-- Ranked tiers and RR changes, copied from the browser version (js/ranks.js).
local Ranks = {}

Ranks.TIERS = {
	{ name = "Rookie", color = Color3.fromHex("9aa4ae") },
	{ name = "Bronze", color = Color3.fromHex("c47a3a") },
	{ name = "Silver", color = Color3.fromHex("c8d2dc") },
	{ name = "Gold", color = Color3.fromHex("ffc83a") },
	{ name = "Platinum", color = Color3.fromHex("4fd8c8") },
	{ name = "Diamond", color = Color3.fromHex("8ab4ff") },
	{ name = "Master", color = Color3.fromHex("c06bff") },
	{ name = "Legend", color = Color3.fromHex("ff4f6a") },
}
local DIV = { "I", "II", "III" }
Ranks.PER_DIV = 100
local LEGEND_AT = (#Ranks.TIERS - 1) * 3 * Ranks.PER_DIV

function Ranks.rankOf(rr: number)
	rr = math.max(0, math.floor(rr or 0))
	if rr >= LEGEND_AT then
		local t = Ranks.TIERS[#Ranks.TIERS]
		return { name = "Legend", color = t.color, progress = 1, legend = true }
	end
	local step = rr // Ranks.PER_DIV
	local tier = step // 3 + 1
	local div = step % 3 + 1
	return {
		name = Ranks.TIERS[tier].name .. " " .. DIV[div],
		color = Ranks.TIERS[tier].color,
		progress = (rr % Ranks.PER_DIV) / Ranks.PER_DIV,
		legend = false,
	}
end

function Ranks.rrDelta(won: boolean, myScore: number, theirScore: number, kills: number, deaths: number): number
	local diff = math.abs(myScore - theirScore)
	local perf = math.clamp((kills - deaths) * 0.8, -4, 6)
	if won then
		return math.round(math.clamp(16 + diff * 1.3 + perf, 10, 32))
	end
	return -math.round(math.clamp(22 - (7 - diff) * 0.9 - perf, 8, 28))
end

return Ranks
