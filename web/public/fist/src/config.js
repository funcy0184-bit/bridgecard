// config.js — 所有可調數值集中在這裡（玩法 CONFIG ＋ 美術規格 ART）
//   · ART：art_spec.json v1.2 原樣（色盤、地台、損傷字分級、HUD 鍵位卡、架式氣泡、提示、特效、Sprite／武器切格表）
//   · CONFIG：玩法時間、損傷、擊飛公式、鍵位、AI 難度、提示開關、線上連線
export const ART = {
  "schemaVersion": "1.2.0",
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
        "id": "stable",
        "label": "穩如泰山",
        "minInclusive": 0,
        "maxInclusive": 44,
        "fill": "#F4F6FA",
        "outline": "#223148",
        "shadow": "#0A0F1A",
        "smoke": false,
        "motion": {
          "trigger": "none",
          "offsetsPx": [
            [
              0,
              0
            ]
          ],
          "frameMs": 45
        },
        "particles": []
      },
      {
        "id": "wobbling",
        "label": "腳步微晃",
        "minInclusive": 45,
        "maxInclusive": 84,
        "fill": "#FFE186",
        "outline": "#64451F",
        "shadow": "#251910",
        "smoke": false,
        "motion": {
          "trigger": "damage_increase",
          "offsetsPx": [
            [
              -1,
              0
            ],
            [
              1,
              0
            ],
            [
              0,
              0
            ]
          ],
          "frameMs": 45
        },
        "particles": [
          {
            "kind": "spark",
            "shape": "square",
            "trigger": "damage_increase",
            "anchor": "outer_lower_corners",
            "layer": "behind_text",
            "colors": [
              "#FFE186",
              "#F2AB52"
            ],
            "count": 2,
            "sizeRangePx": [
              1,
              2
            ],
            "lifetimeMs": 135,
            "travelPx": [
              3,
              -4
            ]
          }
        ]
      },
      {
        "id": "teetering",
        "label": "搖搖欲墜！",
        "minInclusive": 85,
        "maxInclusive": 124,
        "fill": "#FFAA63",
        "outline": "#653221",
        "shadow": "#331922",
        "smoke": false,
        "motion": {
          "trigger": "damage_increase",
          "offsetsPx": [
            [
              0,
              0
            ],
            [
              -1,
              1
            ],
            [
              1,
              0
            ],
            [
              -1,
              0
            ],
            [
              0,
              0
            ]
          ],
          "frameMs": 40
        },
        "particles": [
          {
            "kind": "crack",
            "shape": "stepped_fork",
            "trigger": "band_active",
            "anchor": "outside_upper_corners",
            "layer": "behind_text",
            "colors": [
              "#A85035",
              "#FFC18A"
            ],
            "count": 2,
            "lineWidthPx": 1,
            "lengthRangePx": [
              4,
              7
            ],
            "lifetimeMs": null
          },
          {
            "kind": "spark",
            "shape": "square",
            "trigger": "damage_increase",
            "anchor": "crack_tips",
            "layer": "behind_text",
            "colors": [
              "#FFD194",
              "#F07848"
            ],
            "count": 3,
            "sizeRangePx": [
              1,
              2
            ],
            "lifetimeMs": 170,
            "travelPx": [
              4,
              -5
            ]
          }
        ]
      },
      {
        "id": "critical",
        "label": "瀕死！！",
        "minInclusive": 125,
        "maxInclusive": null,
        "fill": "#E05266",
        "outline": "#571F36",
        "shadow": "#1A0D18",
        "topRim": "#FFD7D9",
        "smoke": true,
        "smokeColor": "#7D374D",
        "motion": {
          "trigger": "damage_increase",
          "offsetsPx": [
            [
              -1,
              0
            ],
            [
              1,
              -1
            ],
            [
              -1,
              1
            ],
            [
              1,
              0
            ],
            [
              0,
              0
            ]
          ],
          "frameMs": 38
        },
        "particles": [
          {
            "kind": "crack",
            "shape": "stepped_fork",
            "trigger": "band_active",
            "anchor": "outside_upper_corners",
            "layer": "behind_text",
            "colors": [
              "#A64052",
              "#F3818B"
            ],
            "count": 2,
            "lineWidthPx": 1,
            "lengthRangePx": [
              6,
              9
            ],
            "lifetimeMs": null
          },
          {
            "kind": "smoke",
            "shape": "stepped_cluster",
            "trigger": "band_active",
            "anchor": "outer_top_edge",
            "layer": "behind_text",
            "colors": [
              "#7D374D",
              "#251C2B",
              "#151520"
            ],
            "maxAlive": 3,
            "sizeRangePx": [
              2,
              4
            ],
            "spawnIntervalMs": 200,
            "lifetimeMs": 560,
            "travelPx": [
              2,
              -8
            ],
            "maxOpacity": 0.4
          },
          {
            "kind": "spark",
            "shape": "square",
            "trigger": "damage_increase",
            "anchor": "crack_tips",
            "layer": "behind_text",
            "colors": [
              "#FFD7D9",
              "#FF746A"
            ],
            "count": 2,
            "sizeRangePx": [
              1,
              2
            ],
            "lifetimeMs": 135,
            "travelPx": [
              4,
              -4
            ]
          }
        ]
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
    "damageText": {
      "bandsFrom": "palette.damageBands",
      "valueSource": "displayed_damage_percent",
      "clampDisplayedValueMin": 0,
      "rounding": "floor",
      "cutoffsAffectGameplay": false,
      "numberUsesPaletteBand": true,
      "statusLabel": {
        "visibility": "always",
        "fontSizePx": 10,
        "offsetFromPanelAnchorPx": [
          0,
          48
        ],
        "alignWithPlayerPanel": true
      },
      "outlineWidthPx": 1,
      "shadowOffsetPx": [
        1,
        1
      ],
      "topRimWidthPx": 1,
      "maxOffsetPx": 1,
      "particlesOccludeGlyphs": false,
      "particleSource": "palette.damageBands[].particles",
      "legacyDamageSmokeFallbackOnly": true,
      "reducedMotion": {
        "offsetPx": [
          0,
          0
        ],
        "animateParticles": false,
        "retainCracksAndCriticalSmokeSilhouette": true
      }
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
      "cardStyle": {
        "cornerCutPx": 2,
        "outerBorderWidthPx": 1,
        "innerBorderWidthPx": 1,
        "statePriority": [
          "locked",
          "pressed",
          "parry_guide",
          "normal"
        ],
        "states": {
          "normal": {
            "outer": "#0B111B",
            "rim": "#4D5D73",
            "highlight": "#788DA4",
            "fill": "#1B2739",
            "glyph": "#F4F3EE",
            "shadow": "#0C1321",
            "bottomBevelPx": 2
          },
          "pressed": {
            "outer": "#0B111B",
            "rim": "#FFF5D8",
            "highlight": "#FFFBE9",
            "fill": "#35445B",
            "glyph": "#FFFBE9",
            "shadow": "#101827",
            "offsetYPx": 1,
            "bottomBevelPx": 1,
            "durationMs": 85,
            "trigger": "accepted_key_down"
          },
          "locked": {
            "outer": "#0B111B",
            "rim": "#414956",
            "highlight": "#596271",
            "fill": "#181F2A",
            "glyph": "#8F9AAA",
            "shadow": "#0C111B",
            "bottomBevelPx": 1,
            "hatch": {
              "color": "#2C3340",
              "periodPx": 4,
              "layer": "below_glyph"
            },
            "emissive": false,
            "trigger": "input_locked_or_slot_disabled"
          },
          "parry_guide": {
            "outer": "#112742",
            "rim": "#58B6FF",
            "highlight": "#C7EEFF",
            "fill": "#1B304A",
            "glyph": "#E4F7FF",
            "shadow": "#0C1830",
            "bottomBevelPx": 2,
            "glow": {
              "color": "#58B6FF",
              "widthPx": 1,
              "alphaSteps": [
                0.32,
                0.55,
                0.72,
                0.55
              ],
              "stepMs": 90,
              "reducedMotionAlpha": 0.55
            },
            "trigger": "blue_parry_and_slot_is_enabled",
            "eligiblePlayerRole": "defender",
            "settingKey": "showClearMoveCues",
            "revealCounterAnswer": false
          }
        }
      },
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
    "clearMoveCuePreference": {
      "settingKey": "showClearMoveCues",
      "defaultEnabled": true,
      "whenDisabledHide": [
        "public_stance_bubbles",
        "hidden_question_bubble",
        "optional_parry_card_glow"
      ],
      "alwaysVisible": [
        "blue_parry_cue",
        "red_roll_hazard",
        "red_roll_safe_arrow",
        "hud_key_icons",
        "hud_key_press_feedback",
        "hud_hard_lock_feedback"
      ],
      "preserveTimingsAndInput": true
    },
    "stanceBubbles": {
      "settingKey": "showClearMoveCues",
      "sizePx": [
        24,
        24
      ],
      "anchor": "fighter_foot",
      "offsetPx": [
        0,
        -55
      ],
      "glyphOriginPx": [
        5,
        3
      ],
      "glyphSizePx": [
        14,
        14
      ],
      "outerOutline": "#0A0F1A",
      "outerOutlineWidthPx": 1,
      "innerRimWidthPx": 1,
      "framePolygonPx": [
        [
          3,
          0
        ],
        [
          20,
          0
        ],
        [
          23,
          3
        ],
        [
          23,
          17
        ],
        [
          20,
          20
        ],
        [
          14,
          20
        ],
        [
          12,
          23
        ],
        [
          9,
          20
        ],
        [
          3,
          20
        ],
        [
          0,
          17
        ],
        [
          0,
          3
        ]
      ],
      "innerRimPlacement": "inside_top_and_side_edges",
      "renderLayer": "above_world_fx_below_hud",
      "initialOpacity": 1,
      "replaceWhenBlueParryCueActive": true,
      "phaseToVariantSource": {
        "standoff": "visible_stance",
        "hidden_commit": "hidden"
      },
      "variants": {
        "rock": {
          "glyph": "sledgehammer",
          "panel": "#2D211B",
          "rim": "#FFC56D",
          "ink": "#FFF2C8",
          "accent": "#D58C45",
          "geometry": {
            "inkRects": [
              [
                3,
                1,
                10,
                5
              ]
            ],
            "inkPolygons": [
              [
                [
                  8,
                  5
                ],
                [
                  11,
                  5
                ],
                [
                  7,
                  13
                ],
                [
                  4,
                  13
                ]
              ]
            ],
            "accentRects": [
              [
                4,
                5,
                8,
                1
              ]
            ]
          }
        },
        "scissors": {
          "glyph": "open_v_shears",
          "panel": "#152A38",
          "rim": "#81CBD9",
          "ink": "#D9F4FF",
          "accent": "#76AFBE",
          "geometry": {
            "inkRects": [
              [
                0,
                2,
                4,
                4
              ],
              [
                0,
                8,
                4,
                4
              ]
            ],
            "inkPolygons": [
              [
                [
                  3,
                  4
                ],
                [
                  6,
                  5
                ],
                [
                  13,
                  1
                ],
                [
                  12,
                  4
                ],
                [
                  7,
                  7
                ],
                [
                  6,
                  8
                ],
                [
                  3,
                  9
                ]
              ],
              [
                [
                  3,
                  9
                ],
                [
                  5,
                  6
                ],
                [
                  7,
                  6
                ],
                [
                  13,
                  12
                ],
                [
                  10,
                  12
                ],
                [
                  5,
                  8
                ]
              ]
            ],
            "clearRects": [
              [
                1,
                3,
                2,
                2
              ],
              [
                1,
                9,
                2,
                2
              ]
            ],
            "accentRects": [
              [
                6,
                6,
                1,
                1
              ]
            ]
          }
        },
        "paper": {
          "glyph": "open_palm_with_wind",
          "panel": "#173021",
          "rim": "#A4DF9A",
          "ink": "#E7FCE9",
          "accent": "#76BE77",
          "geometry": {
            "inkRects": [
              [
                4,
                6,
                7,
                5
              ],
              [
                5,
                2,
                1,
                5
              ],
              [
                7,
                1,
                1,
                6
              ],
              [
                9,
                2,
                1,
                5
              ],
              [
                11,
                4,
                1,
                4
              ],
              [
                5,
                10,
                5,
                3
              ]
            ],
            "inkPolygons": [
              [
                [
                  3,
                  5
                ],
                [
                  4,
                  5
                ],
                [
                  6,
                  8
                ],
                [
                  6,
                  11
                ],
                [
                  3,
                  8
                ]
              ]
            ],
            "accentRects": [
              [
                0,
                3,
                3,
                1
              ],
              [
                0,
                10,
                3,
                1
              ],
              [
                11,
                9,
                3,
                1
              ]
            ]
          }
        },
        "hidden": {
          "glyph": "question_mark",
          "panel": "#181821",
          "rim": "#9B91AD",
          "ink": "#F1EBFF",
          "accent": "#7A708E",
          "geometry": {
            "inkRects": [
              [
                4,
                1,
                6,
                2
              ],
              [
                3,
                3,
                2,
                2
              ],
              [
                9,
                3,
                2,
                3
              ],
              [
                7,
                6,
                3,
                2
              ],
              [
                6,
                7,
                2,
                3
              ],
              [
                6,
                11,
                2,
                2
              ]
            ]
          },
          "mist": {
            "colors": [
              "#0C0D14",
              "#2C2938"
            ],
            "layer": "inside_frame_behind_glyph",
            "maxClusters": 4,
            "clusterSizePx": [
              3,
              2
            ],
            "maxOpacity": 0.65,
            "stepMs": 120,
            "staticWhenReducedMotion": true,
            "source": "shared_mist_pattern"
          }
        }
      },
      "geometryDrawingOrder": [
        "inkRects",
        "inkPolygons",
        "clearRects",
        "accentRects"
      ],
      "geometryClearScope": "glyph_only",
      "clampToCanvas": true,
      "onFighterOverlap": {
        "minCenterGapPx": 26,
        "maxVerticalStaggerPx": 12,
        "avoidHudRect": true,
        "stabilizeAssignmentByPlayerSlot": true
      }
    },
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
      "gestureGeometryFrom": "telegraphs.stanceBubbles.variants",
      "drawGestureWithBluePalette": true,
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
  "weapons": {
    "gestureSourceByState": {
      "clash": "resolved_round_gesture",
      "combo_1": "resolved_round_gesture",
      "combo_2": "resolved_round_gesture",
      "finisher_blue": "revealed_finisher_gesture",
      "finisher_red": "revealed_finisher_gesture"
    },
    "byGesture": {
      "rock": {
        "id": "sledgehammer",
        "label": "大槌子",
        "stanceState": "stance_rock",
        "visualCue": "high_rectangular_head_on_one_long_handle",
        "animationAtlas": "spriteAtlas"
      },
      "scissors": {
        "id": "giant_shears",
        "label": "大剪刀",
        "stanceState": "stance_scissors",
        "visualCue": "single_open_v_with_one_hinge_and_two_loop_handles",
        "animationAtlas": "weaponVariantAtlas"
      },
      "paper": {
        "id": "cloth_sack",
        "label": "大布袋",
        "stanceState": "stance_paper",
        "visualCue": "gathered_mouth_and_low_bulging_belly",
        "animationAtlas": "weaponVariantAtlas"
      }
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
        "frames": 6,
        "fps": 12,
        "playback": "loop",
        "keyFrames": {
          "readablePose": 0,
          "weightDip": 2,
          "hoist": 4
        }
      },
      "stance_scissors": {
        "row": 4,
        "frames": 6,
        "fps": 12,
        "playback": "loop",
        "keyFrames": {
          "readablePose": 0,
          "openWide": 2,
          "halfClose": 4
        }
      },
      "stance_paper": {
        "row": 5,
        "frames": 6,
        "fps": 12,
        "playback": "loop",
        "keyFrames": {
          "readablePose": 0,
          "liftMouth": 2,
          "squashRebound": 4
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
  },
  "weaponVariantAtlas": {
    "imageByPlayer": {
      "p1": "fighter_p1_weapons.png",
      "p2": "fighter_p2_weapons.png"
    },
    "imageWidth": 500,
    "imageHeight": 500,
    "columns": 10,
    "rows": 10,
    "cellLayoutFrom": "spriteAtlas",
    "animationTimingFrom": "spriteAtlas.animations",
    "missingVariantFallback": "hold_matching_weapon_stance",
    "variantsByGesture": {
      "scissors": {
        "clash": {
          "row": 0,
          "anchors": {
            "contact": [
              40,
              20
            ]
          }
        },
        "combo_1": {
          "row": 1,
          "anchors": {
            "contact": [
              45,
              23
            ]
          }
        },
        "combo_2": {
          "row": 2,
          "anchors": {
            "contact": [
              43,
              20
            ]
          }
        },
        "finisher_blue": {
          "row": 3,
          "anchors": {
            "contact": [
              44,
              24
            ]
          }
        },
        "finisher_red": {
          "row": 4,
          "anchors": {
            "contact": [
              45,
              36
            ]
          }
        }
      },
      "paper": {
        "clash": {
          "row": 5,
          "anchors": {
            "contact": [
              38,
              28
            ]
          }
        },
        "combo_1": {
          "row": 6,
          "anchors": {
            "contact": [
              40,
              25
            ]
          }
        },
        "combo_2": {
          "row": 7,
          "anchors": {
            "contact": [
              44,
              28
            ]
          }
        },
        "finisher_blue": {
          "row": 8,
          "anchors": {
            "contact": [
              43,
              21
            ]
          }
        },
        "finisher_red": {
          "row": 9,
          "anchors": {
            "contact": [
              41,
              38
            ]
          }
        }
      }
    }
  }
};

export const CONFIG = {
  W: ART.canvas.width, H: ART.canvas.height,
  cells: ART.stage.tileCount, cellW: ART.stage.tileWidthPx, stageX: ART.stage.leftX, floorY: ART.stage.surfaceY,
  stocks: 3,
  spawn: [3, 5],                                   // 開局與掉命後的站位（P1、P2）

  // ================= 節奏秒數（全部集中在這裡，實測後直接改） =================
  // v4 流程：猜拳 → 開牌 → 贏拳方連勝 +1
  //   連勝 1、2：單發重擊（小傷＋推 1 格）→ 下一輪猜拳
  //   連勝 3：🔥 連勝爆發 → 四套拳（每拳：攻方選拳 → 守方逐拳反擊）→ 連勝歸零
  //   平手：不動連勝，累積拼刀蓄力（2 次 → 五連斬）
  // （站位只靠重擊推擠、四套拳推擠、反擊換位、擊飛落點）
  rps: { dur: 2.8, reveal: 2.2 },                  // 前 2.2s 亮招前搖、後 0.6s 黑影藏招
  reveal: { dur: 0.55 },                           // 開牌停頓：鎖定瞬間停 0.55s，中央放大顯示誰壓制誰
  // 武器過熱：分出勝負後，雙方剛出的手勢下一輪猜拳不能選（拼刀結算、掉命重生後清除）
  overheat: { enabled: true },
  // 拼刀：整場「累積」平手 CLASH_TRIGGER_TIES 次（不用連續）→ 五連斬預輸入 → 由慢到快五刀對砍 → 依主招分流三種勝利大招
  //   第 1 次平手：小拼刀「叮！」彈開（不回氣、過熱不重置），拼刀蓄力 1/2；集滿 → 大拼刀；結算或有人落台後歸零
  CLASH_TRIGGER_TIES: 2,
  CLASH_SEQUENCE_LENGTH: 5,
  clashMode: {
    inputDur: 3.5,                                   // 五連斬預輸入（過熱不限制）
    dashDur: 0.25, dashZoom: 1.22, rush: 14,         // 衝刺交會：0.25s、鏡頭拉近 1.22x
    // 每刀：距上一刀的間隔、鏡頭倍率、頓幀、音高（由慢到快、逐刀加強）；第 5 刀多 2 幀黑白反色衝擊幀
    cuts: [
      { gap: 0.55, zoom: 1.22, hitstop: 50, pitch: 1.00 },
      { gap: 0.40, zoom: 1.27, hitstop: 60, pitch: 1.10 },
      { gap: 0.28, zoom: 1.32, hitstop: 70, pitch: 1.20 },
      { gap: 0.20, zoom: 1.37, hitstop: 80, pitch: 1.32 },
      { gap: 0.14, zoom: 1.45, hitstop: 180, pitch: 1.45, impactFrames: 2 },
    ],
    resolvePause: 0.12,                              // 第 5 刀頓幀後，停一下再宣布勝負
    tiebreakSlow: 0.25,                              // 同分靠先手：「⚡ 先手絕殺！」金光慢動作
    winDamage: 24, firstBonus: 6,                    // 勝方大招 +24%（持先手再 +6%）
    launch: { angle: 48, mult: 1.3 },                // ★ 三種大招共用同一組擊飛角度與倍率（致死率完全一樣）
    // 主招專屬勝利動畫：只差演出（windup＝出招前搖、頓幀、震動），傷害與擊飛完全相同
    finisher: {
      rock: { name: "崩山重砸", windup: 0.45, hitstopMs: 96, shakePx: 4, shakeMs: 155 },                     // 跳起垂直重砸
      scissors: { name: "居合十字斬", windup: 0.30, dash: 0.12, hitstopMs: 65, shakePx: 2, shakeMs: 90 },   // 0.12s 穿身＋靜止 0.18s 後炸開
      paper: { name: "零距離氣功轟飛", windup: 0.42, hitstopMs: 82, shakePx: 3, shakeMs: 135, palmCellPx: [42, 23] },   // 貼身轟出氣功波
    },
    letterboxPx: 18, dim: 0.6,                       // 電影黑邊、背景壓暗
  },
  // 越打越快：整場每 3 回合（一次猜拳結算＝一回合）升一級，最多 Lv.4；教學道場不加速
  //   各階段時間 = 開局值 →（線性）→ fast 值
  speed: { roundsPerLevel: 3, maxLevel: 3, fast: { rpsReveal: 1.6, rpsHidden: 0.5, comboPrep: 0.45, comboReact: 0.75 } },
  clash: { dur: 0.75 },                            // 小拼刀「叮！」／平分白浪彈開

  // ---- 連勝：猜拳連贏 STREAK_TARGET 次才進四套拳；輸一輪或有人落台就歸零；平手不動 ----
  STREAK_TARGET: 3,
  strike: { dur: 0.7, hitAt: 0.22, damage: 8, push: 1, hitstopMs: 90 },   // 連勝 1、2：單發紮實重擊（+8%、推 1 格）

  // ---- 四套拳（連勝爆發後）：每拳 = 攻方選拳 prepDur → 守方反擊窗 reactDur → 命中 impactDur ----
  combo: {
    hits: 4,
    burstDur: 1.1,                                 // 「🔥 連勝爆發！四連擊開始！」大字演出
    prepDur: 0.55,                                 // 攻方選這一拳出什麼（沒按＝系統隨機）；守方看不到
    reactDur: 0.9,                                 // ★ 守方反擊時間（拳種亮出後，只認第一下；建議 0.85～1.0 實測再縮）
    impactDur: 0.35,                               // 吃拳後停一下再進下一拳
    hitDamage: [5, 5, 5, 9],                       // 第 1～4 拳各自傷害（%）
    push: 1,                                       // 第 1～3 拳把守方往崖邊推幾格
    finalLaunch: 1.15,                             // 第 4 拳擊飛倍率（擊飛公式再 × 這個）
    counterDamage: 10, counterKnock: 1, counterHitstopMs: 150,   // 反擊成功：反打 +10%、擊退 1 格、頓幀
    slowmo: 0.35,                                  // 反擊窗畫面慢動作倍率（只影響畫面）
  },
  resolve: {
    minDur: 0.6,
    vBase: 150,                                    // V = vBase × (1 + damage / damageDiv)
    damageDiv: 100,                                // 110%～140% 以上才容易一發出場
    angleDeg: 48,
    gravity: 900,
    koMargin: 26,
    koPause: 0.9,
  },

  // ---- 演出 ----
  countdown: { urgentSec: 0.15, tickEvery: 0.1, phaseTickLast: 0.3, bigBarW: 160 },
  feel: { zoomCombo: 1.14, zoomLerp: 8 },          // 四套拳時鏡頭推近
  skin: "#E6B48A",
  cloth: { fill: "#C8A36B", shade: "#8B6B43", tie: "#5E4630" },   // 大布袋（程式繪製用；正式圖由武器圖集提供）
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
    //   counterRate＝四套拳每拳反擊成功率、counterMs＝看到拳種後多久按（要小於 combo.reactDur 才來得及）
    easy: { name: "新手木樁", reactionMs: 550, counterRead: 0.2, feint: false, hiddenSwitch: false, counterRate: 0.25, counterMs: 650, clashMs: 560, readHeat: 0.2 },
    mid: { name: "道場師兄", reactionMs: 350, counterRead: 0.5, feint: false, hiddenSwitch: false, counterRate: 0.5, counterMs: 450, clashMs: 380, readHeat: 0.7 },
    master: { name: "讀心宗師", reactionMs: 220, counterRead: 0.7, feint: true, hiddenSwitch: true, counterRate: 0.75, counterMs: 280, clashMs: 150, readHeat: 0.9 },
  },

  // ---- 測試場景 ----
  scenarios: [
    { name: "場景 1：中央對峙", p: [{ pos: 3, damage: 0 }, { pos: 5, damage: 0 }] },
    { name: "場景 2：崖邊壓迫", p: [{ pos: 5, damage: 0 }, { pos: 7, damage: 90 }] },
  ],
  // ---- 出招提示（showHints：頭頂拳種氣泡、藏招 ❓、四套拳反擊時剋制鍵發光；線上只影響本機畫面） ----
  hints: { default: true, storageKey: "fist.showHints" },
  // ---- 耐受度狀態字（分級、顏色、粒子讀 ART.palette.damageBands） ----
  status: { criticalAlt: "一擊必飛！！", altEverySec: 0.9, flashEverySec: 1.3, flashMs: 90, popMs: 220, jitter: { teetering: { px: 1, hz: 6 }, critical: { px: 2, hz: 22 } } },
  // ---- 美術驗收：畫出每個角色的 50×50 格框（綠）與腳底錨點 (24, 40)（紅點）；遊戲中可用 __fist.CONFIG.DEBUG_SPRITE_BOX = true 即時切換 ----
  DEBUG_SPRITE_BOX: false,
  // ---- 拼刀專用圖集（clash_art_spec.json v2.0.0）：fighter_p*_clash.png，500×500、10 列；格距、透明邊、腳底錨點 (24, 40) 同 spriteAtlas ----
  //   contactFrame＝刀刃接觸那一格（對砍時這一格對齊每一刀的判定時刻）；impactFrame＝大招命中那一格（對齊引擎的命中時刻）
  clashAtlas: {
    imageByPlayer: { p1: "fighter_p1_clash.png", p2: "fighter_p2_clash.png" }, imageWidth: 500, imageHeight: 500,
    animations: {
      clash_charge: { row: 0, frames: 4, fps: 10, playback: "loop" },                                   // 按刀蓄勢（五連斬輸入中）
      clash_first_draw: { row: 1, frames: 6, fps: 20, playback: "hold_last", starFrame: 2, starCellPx: [27, 28] },   // 先手拔刀：第 2 格噴拔刀星芒
      clash_dash: { row: 2, frames: 4, fps: 24, playback: "hold_last" },                                // 拼刀衝刺
      clash_rock: { row: 3, frames: 5, fps: 18, playback: "hold_last", contactFrame: 3 },                // 石頭重砸
      clash_scissors: { row: 4, frames: 5, fps: 24, playback: "hold_last", contactFrame: 2 },            // 雙刃斜斬
      clash_paper: { row: 5, frames: 5, fps: 18, playback: "hold_last", contactFrame: 3 },               // 布掌風推擊
      clash_recoil: { row: 6, frames: 4, fps: 20, playback: "hold_last", flashFrame: 0 },                // 閃白彈開（第 0 格就是閃白；減少動態從第 1 格起）
      clash_win_rock: { row: 7, frames: 8, fps: 16, playback: "hold_last", impactFrame: 5, renderOffsetY: [0, 0, -7, -14, -9, 0, 0, 0] },   // 崩山重砸（跳躍只位移圖、腳底錨點不動）
      clash_win_scissors: { row: 8, frames: 8, fps: 22, playback: "hold_last", impactFrame: 5, crossFrame: 3 },     // 居合十字斬（第 3 格穿身）
      clash_win_paper: { row: 9, frames: 8, fps: 16, playback: "hold_last", impactFrame: 5 },           // 零距離氣功轟飛（0–3 格蓄氣）
    },
  },
  // ---- 開牌／勝利加購圖集：fighter_p*_v3_addon.png，500×450、9 列（拼刀動作改用上面的專用圖集）----
  extraAtlas: {
    imageByPlayer: { p1: "fighter_p1_v3_addon.png", p2: "fighter_p2_v3_addon.png" }, imageWidth: 500, imageHeight: 450,
    animations: {
      reveal_win: { row: 0, frames: 4, fps: 12, playback: "hold_last" },          // 開牌壓制
      reveal_lose: { row: 1, frames: 4, fps: 12, playback: "hold_last" },         // 開牌受壓
      victory: { row: 8, frames: 6, fps: 10, playback: "hold_last" },             // 勝利收勢
    },
  },
  // ---- 特效圖（一張橫條、由左到右）。layer：back＝角色後方、front＝角色前方；pivot＝貼齊點（格內像素） ----
  vfx: {
    vfx_sparks: { file: "vfx_sparks.png", frameW: 48, frameH: 48, frames: 5, fps: 24, pivot: [24, 24], layer: "front" },
    vfx_slash: { file: "vfx_slash.png", frameW: 64, frameH: 64, frames: 5, fps: 24, pivot: [32, 32], layer: "front" },
    vfx_red_crack: { file: "vfx_red_crack.png", frameW: 96, frameH: 32, frames: 6, fps: 16, pivot: [48, 12], layer: "back",
      clips: { warning: { start: 0, end: 2, loop: true }, impact: { start: 3, end: 5, loop: false } } },
    vfx_ko_pillar: { file: "vfx_ko_pillar.png", frameW: 64, frameH: 270, frames: 6, fps: 16, pivot: [32, 269], layer: "back" },
    // clash_art_spec.json v2.0.0
    vfx_clash_spark: { file: "vfx_clash_spark.png", frameW: 48, frameH: 48, frames: 5, fps: 24, pivot: [24, 24], layer: "front" },           // 拼刀相撞火花
    vfx_first_draw_star: { file: "vfx_first_draw_star.png", frameW: 24, frameH: 24, frames: 4, fps: 24, pivot: [12, 12], layer: "front" },   // 拔刀星芒
    vfx_win_rock_slam: { file: "vfx_win_rock_slam.png", frameW: 96, frameH: 64, frames: 6, fps: 18, pivot: [48, 44], layer: "front" },       // 震地裂岩：貼敗方腳底
    vfx_win_scissors_cross: { file: "vfx_win_scissors_cross.png", frameW: 96, frameH: 96, frames: 6, fps: 24, pivot: [48, 46], layer: "front", burstFrame: 2 },   // 延遲十字斬：第 2 格炸開＝命中
    vfx_win_paper_beam: { file: "vfx_win_paper_beam.png", frameW: 128, frameH: 64, frames: 6, fps: 20, pivot: [3, 32], layer: "front" },     // 翠綠氣功波：從勝方掌心往朝向延伸
  },
  // ---- 線上：暱稱、表情（固定 8 個，不開放自由打字）、新手引導（房主預設） ----
  profile: { nameMax: 8, storageKey: "fist.name" },
  emotes: ["😂", "😡", "👍", "🔥", "😱", "🙏", "🤡", "GG"], emoteGapMs: 1500, emoteShowMs: 2000,
  guide: { default: true, storageKey: "fist.guide" },
  // ---- 震動（Android Chrome 的 navigator.vibrate；iPhone Safari 不開放，只能退而求其次給一下系統觸感） ----
  haptics: {
    storageKey: "fist.haptics", minGapMs: 35,
    dealBase: 18, takeBase: 32,                    // 單發重擊、四套拳第 1～3 拳
    dealFinisher: 30, takeFinisher: [45, 30, 70],  // 四套拳第 4 拳擊飛
    takeRed: [80, 40, 110], dealRed: 45,           // 拼刀大招
    counterMe: [15, 45, 15], gotCountered: 60,     // 反擊成功／被反擊
    burst: [20, 30, 20, 30, 60],                   // 連勝爆發
    clash: 25, koMe: 160, koThem: [30, 40, 30],
  },
  deathmatchTitle: "⚡ 絕命對峙！",
  // ---- 底部鍵位卡文字 ----
  cards: {
    rps: { L: "✊ 石頭", M: "✌️ 剪刀", R: "🖐️ 布" },
    heat: "♨️ 過熱",
  },
  // ---- 線上對戰（worker/gameRoom.js 與 WebSocketTransport 共用） ----
  net: {
    roomCodeLength: 4, codeAlphabet: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",   // 排除 0／O／1／I
    apiPath: "api/rooms", wsPath: "ws/",          // 相對於遊戲頁面網址
    tickHz: 120, broadcastHz: 30,                  // 伺服器引擎步進、畫面同步頻率
    windowGraceMs: 80,                             // 四套拳反擊窗：伺服器多收 80ms（延遲寬容，畫面倒數不變）
    readyCountdownSec: 3, reconnectSec: 15, pingEveryMs: 15000, roomIdleMin: 30,
  },
};
