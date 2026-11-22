// config.js — 所有可調數值集中在這裡（玩法 CONFIG ＋ 美術規格 ART）
//   · ART：art_spec.json v1.0 原樣（色盤、地台、HUD、提示、特效、Sprite 切格表）
//   · CONFIG：玩法時間、損傷、擊飛公式、鍵位、AI 難度、測試場景
export const ART = {
  "schemaVersion": "1.0.0",
  "project": "拳刃交鋒",
  "canvas": {
    "width": 480,
    "height": 270,
    "pixelPerfect": true,
    "imageSmoothingEnabled": false,
    "integerScale": true,
    "roundDrawCoordinates": true
  },
  "stage": {
    "tileCount": 7,
    "tileWidthPx": 48,
    "leftX": 72,
    "rightXExclusive": 408,
    "surfaceY": 184,
    "dangerTileCount": 2,
    "dangerTilesContiguous": true,
    "dangerTileIndexBase": 0,
    "dangerTopBandHeightPx": 6,
    "koBeamX": {
      "left": 16,
      "right": 464
    },
    "koBeamBottomY": 224
  },
  "palette": {
    "background": {
      "skyTop": "#101625",
      "skyHorizon": "#1C2B41",
      "distantCliffs": "#232F46",
      "mist": "#2B3D53",
      "abyss": "#0A0F1A"
    },
    "platform": {
      "outline": "#111622",
      "stoneShadow": "#243249",
      "stoneMid": "#394B61",
      "topEdge": "#8495A6",
      "tileSeam": "#536579",
      "oxidizedBronze": "#796047"
    },
    "fighters": {
      "outline": "#10121B",
      "neutralSteel": "#A9A9AC",
      "p1": {
        "shadow": "#713B29",
        "primary": "#D58941",
        "secondary": "#FFF0C3",
        "highlight": "#FFF9E8"
      },
      "p2": {
        "shadow": "#23544E",
        "primary": "#4BB381",
        "secondary": "#C6F9D8",
        "highlight": "#ECFFF1"
      },
      "hiddenFill": "#131A2A"
    },
    "hud": {
      "plate": "#101827",
      "label": "#F4F3EE",
      "muted": "#8592A4",
      "focusOutline": "#FFF5D8",
      "powerFill": "#F4D58C",
      "powerEmpty": "#39475D"
    },
    "damageBands": [
      {
        "minInclusive": 0,
        "maxInclusive": 39,
        "fill": "#F4F6FA",
        "smoke": false
      },
      {
        "minInclusive": 40,
        "maxInclusive": 69,
        "fill": "#FFE186",
        "smoke": false
      },
      {
        "minInclusive": 70,
        "maxInclusive": 99,
        "fill": "#FFAA63",
        "smoke": false
      },
      {
        "minInclusive": 100,
        "maxInclusive": null,
        "fill": "#E05266",
        "topRim": "#FFD7D9",
        "smoke": true,
        "smokeColor": "#7D374D"
      }
    ],
    "fx": {
      "blue": {
        "outline": "#1B477E",
        "rim": "#58B6FF",
        "core": "#E4F7FF"
      },
      "red": {
        "outline": "#691E37",
        "rim": "#FF4F62",
        "core": "#FFD0A1",
        "hatch": "#FF9A78",
        "floorFill": "#AF263D"
      },
      "safeArrow": {
        "fill": "#FFF5D8",
        "outline": "#151822"
      },
      "impact": {
        "core": "#FFF7E5",
        "spark": "#FFC878"
      },
      "ko": {
        "core": "#FFF3D8",
        "rim": "#FFBE78",
        "outer": "#D77769"
      }
    }
  },
  "hud": {
    "safeMarginPx": {
      "x": 16,
      "y": 12
    },
    "playerPanels": {
      "p1": {
        "anchorX": 16,
        "anchorY": 12,
        "align": "left"
      },
      "p2": {
        "anchorX": 464,
        "anchorY": 12,
        "align": "right"
      },
      "damageFontPx": 24,
      "stockCount": 3,
      "stockSizePx": [
        8,
        8
      ],
      "powerCount": 3,
      "powerSizePx": [
        11,
        5
      ],
      "iconGapPx": 3
    },
    "keyRow": {
      "centerX": 240,
      "topY": 232,
      "keySizePx": [
        30,
        25
      ],
      "gapPx": 5,
      "glyphSizePx": [
        14,
        14
      ],
      "rowsFacing": "screen",
      "slotOrder": [
        "left",
        "center",
        "right"
      ],
      "iconsByPhase": {
        "step": [
          "left_arrow",
          "inactive",
          "right_arrow"
        ],
        "standoff": [
          "rock",
          "scissors",
          "paper"
        ],
        "hidden_commit": [
          "rock",
          "scissors",
          "paper"
        ],
        "combo": [
          "inactive",
          "inactive",
          "inactive"
        ],
        "finisher_select": [
          "rock",
          "scissors",
          "paper"
        ],
        "blue_parry": [
          "rock",
          "scissors",
          "paper"
        ],
        "red_roll": [
          "left_arrow",
          "inactive",
          "right_arrow"
        ],
        "resolution": [
          "inactive",
          "inactive",
          "inactive"
        ]
      }
    }
  },
  "telegraphs": {
    "publicStanceSuggestedMs": 1300,
    "hiddenStanceMs": 500,
    "recognitionTargetMs": 200,
    "blueParry": {
      "inputWindowMs": 500,
      "frameShape": "rounded_square",
      "anchor": "attacker_foot",
      "offsetPx": [
        0,
        -55
      ],
      "frameSizePx": [
        24,
        24
      ],
      "gestureGlyphSizePx": [
        14,
        14
      ],
      "timerStyle": "perimeter_deplete",
      "showCounterAnswer": false
    },
    "redRoll": {
      "cueDurationSuggestedMs": 500,
      "hazardShape": "diagonal_hatch",
      "hazardAnchor": "stage_tile",
      "safeArrowAnchor": "defender_foot",
      "safeArrowOffsetAbsPx": [
        14,
        -7
      ],
      "safeArrowSizePx": [
        12,
        10
      ],
      "hazardFillOpacity": 0.44,
      "hazardHatchPeriodPx": 6,
      "hazardHatchStepMs": 80,
      "timerStyle": "horizontal_deplete",
      "hazardTilesLockedAtCue": true
    }
  },
  "effects": {
    "presentationOnly": true,
    "hitstopMs": {
      "clash": 45,
      "combo_1": 36,
      "combo_2": 48,
      "finisher_blue": 68,
      "finisher_red": 86,
      "parry_success": 120
    },
    "impactFrameFlash": {
      "targetOnly": true,
      "durationMs": 33,
      "maxOpacity": 0.76
    },
    "parryFlash": {
      "localOnly": true,
      "durationMs": 42,
      "maxOpacity": 0.8
    },
    "motionTrail": {
      "maxAfterimages": 3,
      "sampleIntervalMs": 24,
      "lifetimeMs": 96,
      "alphaNewestToOldest": [
        0.42,
        0.26,
        0.12
      ]
    },
    "cameraShakePx": {
      "clash": 1,
      "combo_1": 1,
      "combo_2": 2,
      "finisher_blue": 2,
      "finisher_red": 3,
      "parry_success": 2,
      "ko": 4
    },
    "koBlast": {
      "durationMs": 380,
      "chargeMs": 40,
      "coreMs": 90,
      "fadeMs": 250,
      "beamMaxWidthPx": 22
    },
    "damageSmoke": {
      "maxPuffsPerPlayer": 3,
      "maxHeightPx": 8,
      "maxOpacity": 0.4
    },
    "reducedMotion": {
      "cameraShakeMultiplier": 0,
      "flashOpacityMultiplier": 0,
      "trailMaxAfterimages": 1,
      "staticTelegraphHatching": true,
      "keepCountdownAndSignals": true
    }
  },
  "spriteAtlas": {
    "imageByPlayer": {
      "p1": "fighter_p1.png",
      "p2": "fighter_p2.png"
    },
    "imageWidth": 500,
    "imageHeight": 800,
    "columns": 10,
    "rows": 16,
    "frameWidth": 48,
    "frameHeight": 48,
    "strideX": 50,
    "strideY": 50,
    "originX": 1,
    "originY": 1,
    "pivot": {
      "x": 24,
      "y": 40
    },
    "baseFacing": "right",
    "mirrorForLeft": true,
    "alphaBackground": true,
    "frameIndexBase": 0,
    "stateOrder": [
      "idle",
      "step",
      "exhausted",
      "stance_rock",
      "stance_scissors",
      "stance_paper",
      "stance_hidden",
      "clash",
      "combo_1",
      "combo_2",
      "finisher_blue",
      "finisher_red",
      "parry_success",
      "roll",
      "hitstun",
      "knockback"
    ],
    "animations": {
      "idle": {
        "row": 0,
        "frames": 6,
        "fps": 10,
        "playback": "loop",
        "keyFrames": {
          "neutral": 0,
          "inhalePeak": 3
        }
      },
      "step": {
        "row": 1,
        "frames": 5,
        "fps": 24,
        "playback": "hold_last",
        "keyFrames": {
          "pushOff": 1,
          "plant": 3
        }
      },
      "exhausted": {
        "row": 2,
        "frames": 6,
        "fps": 12,
        "playback": "hold_last",
        "keyFrames": {
          "brake": 0,
          "gasp": 2,
          "readyPose": 5
        }
      },
      "stance_rock": {
        "row": 3,
        "frames": 4,
        "fps": 12,
        "playback": "loop",
        "keyFrames": {
          "readablePose": 0
        }
      },
      "stance_scissors": {
        "row": 4,
        "frames": 4,
        "fps": 12,
        "playback": "loop",
        "keyFrames": {
          "readablePose": 0
        }
      },
      "stance_paper": {
        "row": 5,
        "frames": 4,
        "fps": 12,
        "playback": "loop",
        "keyFrames": {
          "readablePose": 0
        }
      },
      "stance_hidden": {
        "row": 6,
        "frames": 4,
        "fps": 8,
        "playback": "hold_last",
        "keyFrames": {
          "fullyMasked": 0
        }
      },
      "clash": {
        "row": 7,
        "frames": 5,
        "fps": 24,
        "playback": "event_driven",
        "keyFrames": {
          "contact": 1,
          "recoil": 3
        },
        "anchors": {
          "contact": [
            37,
            20
          ]
        }
      },
      "combo_1": {
        "row": 8,
        "frames": 5,
        "fps": 24,
        "playback": "event_driven",
        "keyFrames": {
          "contact": 2,
          "recovery": 4
        },
        "anchors": {
          "contact": [
            39,
            24
          ]
        }
      },
      "combo_2": {
        "row": 9,
        "frames": 6,
        "fps": 24,
        "playback": "event_driven",
        "keyFrames": {
          "contact": 3,
          "recovery": 5
        },
        "anchors": {
          "contact": [
            41,
            20
          ]
        }
      },
      "finisher_blue": {
        "row": 10,
        "frames": 10,
        "fps": 16,
        "playback": "event_driven",
        "keyFrames": {
          "cue": 0,
          "windupLast": 7,
          "contact": 8,
          "recovery": 9
        },
        "anchors": {
          "contact": [
            42,
            23
          ]
        }
      },
      "finisher_red": {
        "row": 11,
        "frames": 10,
        "fps": 16,
        "playback": "event_driven",
        "keyFrames": {
          "cue": 0,
          "windupLast": 7,
          "contact": 8,
          "recovery": 9
        },
        "anchors": {
          "contact": [
            40,
            32
          ]
        }
      },
      "parry_success": {
        "row": 12,
        "frames": 6,
        "fps": 24,
        "playback": "event_driven",
        "keyFrames": {
          "contact": 0,
          "brace": 1,
          "crossStep": 3,
          "settle": 5
        },
        "anchors": {
          "contact": [
            35,
            22
          ]
        }
      },
      "roll": {
        "row": 13,
        "frames": 6,
        "fps": 24,
        "playback": "hold_last",
        "keyFrames": {
          "duck": 0,
          "tuck": 2,
          "land": 4,
          "recover": 5
        }
      },
      "hitstun": {
        "row": 14,
        "frames": 4,
        "fps": 20,
        "playback": "hold_last",
        "keyFrames": {
          "recoil": 0,
          "stagger": 2
        }
      },
      "knockback": {
        "row": 15,
        "frames": 6,
        "fps": 18,
        "playback": "tail_loop",
        "loopStartFrame": 2,
        "keyFrames": {
          "launch": 0,
          "tumbleStart": 2
        }
      }
    }
  }
};

export const CONFIG = {
  W: ART.canvas.width, H: ART.canvas.height,
  cells: ART.stage.tileCount, cellW: ART.stage.tileWidthPx, stageX: ART.stage.leftX, floorY: ART.stage.surfaceY,
  stocks: 3, powerMax: 3, powerStart: 2,
  spawn: [3, 5],                                   // 開局與掉命後的站位（P1、P2）

  // ---- 六階段（秒） ----
  move: { dur: 1.2, maxSteps: 2, stepTime: 0.16, bumpTime: 0.22, secondStepStun: 1.0, wobbleTime: 0.3 },
  rps: { dur: 1.8, reveal: 1.3 },                  // 前 1.3s 亮招、後 0.5s 藏招
  clash: { dur: 0.75 },
  mash: { dur: 0.65, baseHits: [0.12, 0.36], baseDamage: 12, pressesPerExtra: 2, extraDamage: 2, maxExtra: 4 },
  select: { dur: 0.45, chargeTime: 0.3, redCost: 2 },
  window: { dur: 0.5, slowmo: 0.35 },              // slowmo 只影響畫面動作速度
  finisherDamage: 20,
  parry: { counterDamage: 15, counterKnock: 1, hitstopMs: 150 },
  roll: { cells: 2, time: 0.28 },
  resolve: {
    minDur: 0.6,
    vBase: 150,                                    // V = vBase × (1 + damage / damageDiv)，紅招再 × redMult
    damageDiv: 60,
    redMult: 1.45,
    angleDeg: 48,
    gravity: 900,
    koMargin: 26,
    koPause: 0.9,
  },

  // ---- 演出 ----
  countdown: { urgentSec: 0.15, tickEvery: 0.1, phaseTickLast: 0.3, bigBarW: 160 },
  feel: { zoomMash: 1.14, zoomLerp: 8, mashExtraHitstopMs: 22, mashShakePx: [1, 2, 2, 3, 3] },
  skin: "#E6B48A",
  names: ["P1 赭鋒", "P2 翠嵐"],

  // ---- 鍵位（btn：L 左、M 中、R 右） ----
  keys: {
    local2p: [{ KeyA: "L", KeyS: "M", KeyD: "R" }, { KeyJ: "L", KeyK: "M", KeyL: "R" }],
    solo: { KeyA: "L", KeyS: "M", KeyD: "R", KeyJ: "L", KeyK: "M", KeyL: "R", ArrowLeft: "L", ArrowDown: "M", ArrowRight: "R" },
  },
  keyLabel: [{ L: "A", M: "S", R: "D" }, { L: "J", M: "K", R: "L" }],
  gestureOf: { L: "rock", M: "scissors", R: "paper" },   // 左=石頭 中=剪刀 右=布

  // ---- AI 三難度（ai.js 讀這裡） ----
  ai: {
    easy: { name: "新手木樁", reactionMs: 550, mashIntervalMs: 210, parryRate: 0.25, rollRate: 0.35, counterRead: 0.2, feint: false, hiddenSwitch: false, keepPower: 0, defenseMs: 380 },
    mid: { name: "道場師兄", reactionMs: 350, mashIntervalMs: 115, parryRate: 0.55, rollRate: 0.7, counterRead: 0.5, feint: false, hiddenSwitch: false, keepPower: 1, defenseMs: 260 },
    master: { name: "讀心宗師", reactionMs: 220, mashIntervalMs: 70, parryRate: 0.8, rollRate: 0.9, counterRead: 0.7, feint: true, hiddenSwitch: true, keepPower: 2, defenseMs: 190 },
  },

  // ---- 測試場景 ----
  scenarios: [
    { name: "場景 1：中央對峙", p: [{ pos: 3, power: 2, damage: 0 }, { pos: 5, power: 2, damage: 0 }] },
    { name: "場景 2：崖邊二連走位", p: [{ pos: 5, power: 2, damage: 0 }, { pos: 7, power: 2, damage: 90 }] },
    { name: "場景 3：零力量閃紅招", p: [{ pos: 6, power: 2, damage: 0 }, { pos: 7, power: 0, damage: 110 }] },
  ],
  net: { roomCodeLength: 4, path: "/fist/ws/" },
};
