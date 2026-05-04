-- CStanding: M+ Community Standing
-- Shows your percentile rank in the M+ community for Midnight Season 1.
-- Depends on the RaiderIO addon for score data.
-- Type /cstanding to manually refresh.

-- ────────────────────────────────────────────────────────────────────────────
-- Percentile thresholds for Midnight Season 1 (US region, 642,628 tracked chars)
-- Computed from RaiderIO binary lookup by CStanding Updater on 2026-05-04.
-- Re-run UpdateStandings.exe after each RaiderIO update to keep these current.
-- ────────────────────────────────────────────────────────────────────────────
local PERCENTILES = {
    { pct =  0.1,  score = 3787 },
    { pct =  0.5,  score = 3644 },
    { pct =    1,  score = 3557 },
    { pct =  2.5,  score = 3432 },
    { pct =    5,  score = 3318 },
    { pct =   10,  score = 3156 },
},
    { pct =  0.5,  score = 3644 },
    { pct =    1,  score = 3557 },
    { pct =  2.5,  score = 3432 },
    { pct =    5,  score = 3318 },
    { pct =   10,  score = 3156 },
},
    { pct =  0.5,  score = 3644 },
    { pct =    1,  score = 3557 },
    { pct =  2.5,  score = 3432 },
    { pct =    5,  score = 3318 },
    { pct =   10,  score = 3156 },
}

local FRAME_W, FRAME_H = 170, 28

-- ────────────────────────────────────────────────────────────────────────────
-- Score retrieval
-- ────────────────────────────────────────────────────────────────────────────

local function GetPlayerScore()
    if RaiderIO and RaiderIO.GetProfile then
        local profile = RaiderIO.GetProfile("player")
        if profile
            and profile.mythicKeystoneProfile
            and profile.mythicKeystoneProfile.mplusCurrent
        then
            local score = profile.mythicKeystoneProfile.mplusCurrent.score
            if type(score) == "number" and score > 0 then
                return score
            end
        end
    end
    -- Fallback: native WoW M+ rating API (available since Dragonflight)
    local ok, info = pcall(C_PlayerInfo.GetPlayerMythicPlusRatingInfo, "player")
    if ok and info and type(info.currentSeasonScore) == "number" then
        return info.currentSeasonScore
    end
    return 0
end

-- ────────────────────────────────────────────────────────────────────────────
-- Percentile lookup
-- ────────────────────────────────────────────────────────────────────────────

local function GetPercentile(score)
    for _, tier in ipairs(PERCENTILES) do
        if score >= tier.score then
            return tier.pct
        end
    end
    return nil -- below top 10%
end

local function FormatPct(pct)
    -- Avoid trailing ".0" (e.g. 1.0 → "1", 2.5 → "2.5")
    if pct == math.floor(pct) then
        return tostring(math.floor(pct))
    end
    return tostring(pct)
end

-- ────────────────────────────────────────────────────────────────────────────
-- Frame
-- ────────────────────────────────────────────────────────────────────────────

local mainFrame
local standingLabel

local function UpdateDisplay()
    local score = GetPlayerScore()
    if score <= 0 then
        standingLabel:SetText("Standing: No Data")
        standingLabel:SetTextColor(0.6, 0.6, 0.6)
        return
    end

    local pct = GetPercentile(score)
    if pct then
        standingLabel:SetText("Standing: Top " .. FormatPct(pct) .. "%")
        standingLabel:SetTextColor(0.2, 1, 0.4)
    else
        standingLabel:SetText("Standing: Below Top 10%")
        standingLabel:SetTextColor(1, 1, 1)
    end
end

local function SavePosition()
    CStandingDB = CStandingDB or {}
    local scale = mainFrame:GetEffectiveScale() / UIParent:GetEffectiveScale()
    local cx, cy = mainFrame:GetCenter()
    CStandingDB.x = cx * scale
    CStandingDB.y = cy * scale
end

local function RestorePosition()
    if CStandingDB and CStandingDB.x and CStandingDB.y then
        mainFrame:ClearAllPoints()
        mainFrame:SetPoint("CENTER", UIParent, "CENTER", CStandingDB.x, CStandingDB.y)
    end
end

local function CreateMainFrame()
    mainFrame = CreateFrame("Frame", "CStandingFrame", UIParent, "BackdropTemplate")
    mainFrame:SetSize(FRAME_W, FRAME_H)
    mainFrame:SetPoint("CENTER", UIParent, "CENTER", 0, 300)
    mainFrame:SetMovable(true)
    mainFrame:EnableMouse(true)
    mainFrame:RegisterForDrag("LeftButton")
    mainFrame:SetClampedToScreen(true)
    mainFrame:SetFrameStrata("MEDIUM")

    mainFrame:SetBackdrop({
        bgFile   = "Interface\\Tooltips\\UI-Tooltip-Background",
        edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
        tile = true, tileSize = 16, edgeSize = 10,
        insets = { left = 3, right = 3, top = 3, bottom = 3 },
    })
    mainFrame:SetBackdropColor(0, 0, 0, 0.75)
    mainFrame:SetBackdropBorderColor(0.3, 0.3, 0.3, 0.9)

    standingLabel = mainFrame:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    standingLabel:SetPoint("CENTER", mainFrame, "CENTER", 0, 0)
    standingLabel:SetText("Standing: ...")
    standingLabel:SetTextColor(0.6, 0.6, 0.6)

    mainFrame:SetScript("OnDragStart", mainFrame.StartMoving)
    mainFrame:SetScript("OnDragStop", function(self)
        self:StopMovingOrSizing()
        SavePosition()
    end)
end

-- ────────────────────────────────────────────────────────────────────────────
-- Events
-- ────────────────────────────────────────────────────────────────────────────

local eventFrame = CreateFrame("Frame")
eventFrame:RegisterEvent("PLAYER_LOGIN")
eventFrame:RegisterEvent("PLAYER_ENTERING_WORLD")

eventFrame:SetScript("OnEvent", function(_, event)
    if event == "PLAYER_LOGIN" then
        CreateMainFrame()
        RestorePosition()
    elseif event == "PLAYER_ENTERING_WORLD" then
        -- Give RaiderIO and the game client a moment to populate data
        C_Timer.After(3, UpdateDisplay)
    end
end)

-- ────────────────────────────────────────────────────────────────────────────
-- Slash command
-- ────────────────────────────────────────────────────────────────────────────

SLASH_CSTANDING1 = "/cstanding"
SlashCmdList["CSTANDING"] = function()
    UpdateDisplay()
    print("|cff00ccffCStanding:|r " .. standingLabel:GetText())
end
