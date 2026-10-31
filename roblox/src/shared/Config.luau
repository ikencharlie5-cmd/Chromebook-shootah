-- Match rules and tuning, matching the browser version (js/game.js) where it makes sense.
local Config = {}

-- world scale: the browser game is in metres, Roblox in studs
Config.STUDS_PER_M = 3
Config.CELL = 9              -- one map cell (3 m)
Config.WALL_H = 22           -- outer walls / buildings
Config.LEDGE_H = 3           -- "1" cells (jump up)
Config.PLATFORM_H = 7.2      -- "2" cells (stairs up)
Config.LOW_COVER_H = 3.5     -- "c"
Config.TALL_COVER_H = 7.5    -- "C"
Config.ROOF_H = 12           -- "," roofed floor

-- players
Config.TEAM_SIZE = 3         -- per team; more players than this get spread evenly
Config.MAX_HEALTH = 100
Config.RUN_SPEED = 16.2      -- 5.4 m/s
Config.WALK_SPEED = 8.7      -- shift (quiet)
Config.CROUCH_SPEED = 6

-- rounds
Config.FIRST_BUY_TIME = 25
Config.BUY_TIME = 15
Config.ROUND_TIME = 100
Config.CORE_TIME = 40        -- after planting
Config.PLANT_TIME = 4
Config.DEFUSE_TIME = 7
Config.END_TIME = 5
Config.WIN_ROUNDS = 7
Config.HALF = 6              -- swap sides after this many rounds
Config.MIN_PLAYERS = 2       -- a match waits for this many players

-- economy
Config.START_CREDITS = 800
Config.MAX_CREDITS = 9000
Config.WIN_BONUS = 3000
Config.LOSS_BONUS = 1400
Config.LOSS_STREAK_BONUS = 500  -- per round in a losing streak (max 3)
Config.KILL_REWARD = 200
Config.ASSIST_REWARD = 50
Config.PLANT_REWARD = 300

-- lobby rewards (saved coins for the locker)
Config.COINS_PER_KILL = 5
Config.COINS_PER_WIN = 60
Config.COINS_PER_MATCH = 20

return Config
