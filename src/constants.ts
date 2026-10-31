export const VIEW_WIDTH = 320
export const VIEW_HEIGHT = 180

export const CAMERA_LEAN_PX = 28
export const CAMERA_LEAN_EASE_MS = 240

export const MS_PER_SECOND = 1000
export const MAX_FRAME_DELTA_MS = 50
// NOTE: the world steps in whole 60 Hz ticks whatever the display's rate, so
// a 120 Hz phone, a 60 Hz laptop, and the co-op room play the same ticks.
// A frame's time goes into a carry, and each whole tick in it is stepped.
export const FIXED_STEP_MS = 1000 / 60
// NOTE: float sums of frame times can land a hair under a whole tick.
export const STEP_EPSILON_MS = 1e-6

export const PLAYER_RADIUS = 4
// NOTE: how far a zombie's body may sink into the player's. It stays above
// zero so a zombie held at the edge still overlaps the player and bites.
export const CONTACT_ALLOWANCE_PX = 1
export const PLAYER_SPEED = 72
export const PLAYER_MAX_HP = 5
export const MUZZLE_DISTANCE = 6
export const PLAYER_INVULNERABLE_MS = 1000
export const LAST_HEART_INVULNERABLE_MS = 1500
export const PLAYER_KNOCKBACK_SPEED = 170
export const PLAYER_KNOCKBACK_DECAY_PER_SECOND = 12
export const PLAYER_RECOIL_MS = 90

export const FIRE_INTERVAL_MS = 150
export const PISTOL_MAGAZINE = 14
export const PISTOL_RELOAD_MS = 800
export const BULLET_SPEED = 240
export const BULLET_RADIUS = 1.5
export const BULLET_LIFETIME_MS = 900
export const PISTOL_DAMAGE = 1

export const ZOMBIE_RADIUS = 4
export const ZOMBIE_SPEED_MIN = 16
export const ZOMBIE_SPEED_MAX = 28
export const ZOMBIE_SPAWN_MARGIN = 10
// NOTE: the least a zombie walks while it is still outside the room, where
// nothing is drawn, so even a Big Lug is in its doorway a beat after its
// door's warning ends instead of most of a second later.
export const ZOMBIE_ENTRY_SPEED = 50
export const SCORE_PER_ZOMBIE = 10
export const ZOMBIE_MAX_HP = 3
export const ZOMBIE_HIT_PULSE_MS = 160
export const ZOMBIE_HIT_FLASH_MS = 70
export const ZOMBIE_KNOCKBACK_SPEED = 110
export const ZOMBIE_KNOCKBACK_DECAY_PER_SECOND = 16
export const ZOMBIE_BUMP_SPEED = 80
export const ZOMBIE_DYING_MS = 560

export const KNOCKBACK_REST_SPEED = 2

export const TILE_SIZE = 10
export const COLLISION_STEP_PX = 2
export const BULLET_STEP_PX = 2

export const DIRECT_CHASE_FULL_PX = 72
export const DIRECT_CHASE_RANGE_PX = 104
export const LINE_OF_SIGHT_STEP_PX = 3
export const SEPARATION_SPEED = 40

export const FIRST_PREPARATION_MS = 6000
export const PREPARATION_MS = 20000
// NOTE: the break before this wave waits for START WAVE. Later ones are timed.
export const OPEN_BREAK_WAVE = 2
// NOTE: the break before this wave is the first where the kitchen's boards
// are for sale (src/exits.ts) and the guided tutorial's kitchen tour runs.
export const KITCHEN_FIRST_WAVE = 3
export const SPAWN_JITTER_MS = 400
export const STRAGGLER_JITTER_MS = 1500
export const DOOR_SPAWN_SPREAD_PX = 5
export const WAVE_CLEARED_BANNER_MS = 2200
export const WAVE_BANNER_MS = 1600

export const STICK_RADIUS_PX = 56
export const STICK_DEAD_ZONE = 0.15

export const DEFAULT_SEED = 0x2f6b9a1d

export const PLAYER_WALK_FRAME_MS = 110
export const PLAYER_BREATH_FRAME_MS = 520
export const PLAYER_FOOT_OFFSET = 5
export const PLAYER_RECOIL_KICK_PX = 1.5
export const PLAYER_RECOIL_SQUASH = 0.14
export const PLAYER_HURT_FLASH_MS = 90
export const PLAYER_HURT_PULSE_MS = 220
export const PLAYER_HURT_SQUASH = 0.3
export const PLAYER_BLINK_MS = 80
export const PLAYER_BLINK_OPACITY = 0.25

export const ZOMBIE_FOOT_OFFSET = 5
export const ZOMBIE_SHAMBLE_PX_PER_FRAME = 2.5
export const ZOMBIE_SHAMBLE_PHASE_PER_ID = 1.618
export const ZOMBIE_HIT_SQUASH = 0.35
export const ZOMBIE_DEATH_POP_END = 0.2
export const ZOMBIE_DEATH_POP_STRETCH = 0.45
export const ZOMBIE_DEATH_FALL_END = 0.55
export const ZOMBIE_DEATH_LANDING_END = 0.72
export const ZOMBIE_DEATH_LANDING_SQUASH = 0.35
export const ZOMBIE_DEATH_FADE_START = 0.6

export const HEART_PULSE_MS = 360
export const HEART_FLASH_MS = 120
export const HEART_PULSE_GROWTH = 0.8
export const HEART_SHAKE_PX = 1.5
export const HEART_SHAKE_CYCLES = 3
export const ZOMBIE_DEATH_POP_PINCH = 0.3

export const PARTICLE_MAX = 160
export const DECAL_MAX = 220
export const DECAL_FADE_COUNT = 40

export const PARTICLE_BOUNCE_FRICTION = 0.55
export const PARTICLE_BOUNCE_MIN_SPEED = 18

export const BLOOD_PER_HIT = 5
export const BLOOD_PER_KILL = 4
export const BLOOD_SPRAY_SPREAD = 0.9
export const BLOOD_SPEED_MIN = 35
export const BLOOD_SPEED_MAX = 105
export const BLOOD_LIFT_MIN = 10
export const BLOOD_LIFT_MAX = 55
export const BLOOD_GRAVITY = 260
export const BLOOD_DRAG_PER_SECOND = 1.5
export const BLOOD_LIFETIME_MS = 2000

export const MEAT_GIBS_PER_KILL = 4
export const ROT_GIBS_PER_KILL = 2
export const GIB_SPEED_MIN = 20
export const GIB_SPEED_MAX = 75
export const GIB_FORWARD_PUSH = 30
export const GIB_LIFT_MIN = 60
export const GIB_LIFT_MAX = 115
export const GIB_GRAVITY = 300
export const GIB_DRAG_PER_SECOND = 0.8
export const GIB_RESTITUTION = 0.45
export const GIB_LIFETIME_MS = 3000

export const SHELL_EJECT_SPEED_MIN = 28
export const SHELL_EJECT_SPEED_MAX = 46
export const SHELL_KICK_BACK = 0.35
export const SHELL_LIFT_MIN = 40
export const SHELL_LIFT_MAX = 60
export const SHELL_GRAVITY = 320
export const SHELL_DRAG_PER_SECOND = 1
export const SHELL_RESTITUTION = 0.4
export const SHELL_LIFETIME_MS = 2000
export const SHELL_TUMBLE_MS = 45

export const DUST_INTERVAL_MS = 170
export const DUST_PER_HURT = 5
export const DUST_SPEED_MIN = 6
export const DUST_SPEED_MAX = 22
export const DUST_HURT_SPEED_MIN = 20
export const DUST_HURT_SPEED_MAX = 50
export const DUST_LIFT = 8
export const DUST_DRAG_PER_SECOND = 5
export const DUST_LIFETIME_MIN_MS = 260
export const DUST_LIFETIME_MAX_MS = 460
export const DUST_FADE_MS = 160

export const CHIPS_PER_STRIKE = 4
export const DUST_PER_STRIKE = 2
export const CHIP_SPREAD = 1.6
export const CHIP_SPEED_MIN = 30
export const CHIP_SPEED_MAX = 70
export const CHIP_LIFT_MIN = 25
export const CHIP_LIFT_MAX = 55
export const CHIP_HEIGHT = 4
export const CHIP_GRAVITY = 280
export const CHIP_DRAG_PER_SECOND = 2
export const CHIP_RESTITUTION = 0.3
export const CHIP_LIFETIME_MS = 700
export const CHIP_COLOR = '#d8c8a8'

export const MUZZLE_FLASH_MS = 34
export const MUZZLE_FLASH_BIG_MS = 17
export const BULLET_TRAIL_PX = 3

export const PLAYER_SHADOW_WIDTH = 7
export const SHADOW_HEIGHT = 2
export const GIB_SHADOW_WIDTH = 2

export const BLOOD_PARTICLE_COLOR = '#ff3b3f'
export const MEAT_GIB_COLOR = '#d42a35'
export const ROT_GIB_COLOR = '#7fd04b'
export const SHELL_COLOR = '#f2c14e'
export const DUST_COLOR = 'rgba(214, 196, 160, 0.55)'
export const DUST_FADED_COLOR = 'rgba(214, 196, 160, 0.25)'

export const BLOOD_DECAL_COLOR = '#a8202a'
export const MEAT_DECAL_COLOR = '#8e1c25'
export const ROT_DECAL_COLOR = '#4f9a32'
export const SHELL_DECAL_COLOR = '#b88e33'
export const BLOOD_DECAL_FADED_COLOR = '#5a2427'
export const MEAT_DECAL_FADED_COLOR = '#502226'
export const ROT_DECAL_FADED_COLOR = '#335a2a'
export const SHELL_DECAL_FADED_COLOR = '#5f5434'

export const SHADOW_COLOR = 'rgba(0, 0, 0, 0.38)'
export const SHADOW_FADED_COLOR = 'rgba(0, 0, 0, 0.18)'
export const GIB_SHADOW_COLOR = 'rgba(0, 0, 0, 0.3)'
export const SHADOW_FADE_START = 0.6
export const SHADOW_HIDE_START = 0.85

export const MUZZLE_FLASH_OUTER_COLOR = '#ffd23f'
export const MUZZLE_FLASH_CORE_COLOR = '#fffbe6'
export const BULLET_TRAIL_COLOR = 'rgba(255, 224, 102, 0.45)'

export const SHAKE_MAX_PX = 3
export const SHAKE_TRAUMA_MAX = 1
export const SHAKE_DECAY_PER_SECOND = 2.5
export const SHAKE_FIRING_TRAUMA_MAX = 0.3
export const SHAKE_TRAUMA_KILL = 0.15
export const SHAKE_TRAUMA_HURT = 0.9

export const HIT_STOP_KILL_MS = 40
export const HIT_STOP_EXTRA_KILL_MS = 10
export const HIT_STOP_KILL_MAX_MS = 60
export const HIT_STOP_HURT_MS = 70
export const HIT_STOP_MAX_MS = 70
export const HIT_STOP_COOLDOWN_MS = 120

export const POPUP_MAX = 10
export const DAMAGE_POPUP_LIFETIME_MS = 480
export const KILL_POPUP_LIFETIME_MS = 720
export const POPUP_HOP_MS = 140
export const DAMAGE_POPUP_HOP_PX = 5
export const KILL_POPUP_HOP_PX = 7
export const DAMAGE_POPUP_RISE_PX = 8
export const KILL_POPUP_RISE_PX = 10
export const DAMAGE_POPUP_LIFT_PX = 6
export const KILL_POPUP_LIFT_PX = 12
export const POPUP_DRIFT_SPEED_MAX = 14
export const POPUP_FADE_START = 0.6
export const KILL_POPUP_FLASH_MS = 70
export const KILL_POPUP_BIG_SCALE = 1
export const KILL_POPUP_SCALE = 1

export const STREAK_WINDOW_MS = 1600
export const STREAK_MIN_SHOWN = 2
export const STREAK_PULSE_MS = 110
export const STREAK_SCALE = 2
export const STREAK_PULSE_SCALE = 3
export const STREAK_FADE_MS = 400
export const STREAK_FADED_OPACITY = 0.45

export const DAMAGE_GLYPH_COLOR = '#fff4d6'
export const KILL_GLYPH_COLOR = '#ffd23f'
export const STREAK_GLYPH_COLOR = '#ff8a3d'
export const GLYPH_SHADOW_COLOR = '#2a1418'

export const BULLET_MAX = 48

export const SHAMBLER_BOUNTY = 2
export const WAVE_BONUS_BASE = 20
export const WAVE_BONUS_PER_WAVE = 5
export const MONEY_TICK_PER_SECOND = 10

export const SHOP_FIRST_WAVE = 2
export const SHOP_REACH_PX = 12
export const SHOP_LEAVE_PX = 22
export const SHOP_NEAR_PX = 44
export const COINS_PER_PURCHASE = 10
export const COIN_SPEED_MIN = 25
export const COIN_SPEED_MAX = 60
export const COIN_LIFT_MIN = 70
export const COIN_LIFT_MAX = 110
export const COIN_GRAVITY = 300
export const COIN_DRAG_PER_SECOND = 1.5
export const COIN_RESTITUTION = 0.5
export const COIN_LIFETIME_MS = 900
export const COIN_COLOR = '#ffd23f'

export const DRY_FIRE_DELAY_MS = 260
export const CLIP_SIZE_PX = 3
export const CLIP_DROP_SPEED = 24
export const CLIP_LIFT = 40
export const CLIP_LIFETIME_MS = 1400
export const CLIP_COLOR = '#5c6470'
export const CLIP_DECAL_COLOR = '#3c424b'
export const CLIP_DECAL_FADED_COLOR = '#2d3036'
export const RELOAD_BAR_WIDTH = 12
export const RELOAD_BAR_LIFT_PX = 11
export const RELOAD_BAR_COLOR = '#ffe066'
export const RELOAD_BAR_BACK_COLOR = 'rgba(8, 10, 12, 0.7)'
export const HULL_COLOR = '#d8423a'
export const LINK_COLOR = '#d98a4e'
export const HULL_DECAL_COLOR = '#8e2a25'
export const HULL_DECAL_FADED_COLOR = '#4f2624'

export const PAYDAY_POPUP_LIFETIME_MS = 1300
export const PAYDAY_POPUP_LIFT_PX = 16
export const EMPTY_POPUP_LIFETIME_MS = 1100
export const EMPTY_POPUP_LIFT_PX = 16
export const ALERT_GLYPH_COLOR = '#ff6b5e'
export const COIN_GLYPH_COLOR = '#ffe066'

export const DOOR_HALF_WIDTH_PX = 10

export const MAX_BLASTS_PER_FRAME = 2
export const BLAST_FLASH_MS = 320
export const BLAST_MAX = 8
export const SHAKE_TRAUMA_BLAST = 1
export const HIT_STOP_BLAST_MS = 70

export const BLOOD_PER_BLAST = 8
export const BOMB_SHARDS_PER_BLAST = 4
export const SPARKS_PER_BLAST = 10
export const SPARKS_PER_DROP = 6
export const SPARKS_PER_CLANG = 8
export const SPARKS_PER_GRAB = 10
export const COINS_PER_GRAB = 4
export const DUST_PER_FIZZLE = 4
export const DUST_PER_BURP = 14
export const SHAKE_TRAUMA_GRAB = 0.25
export const SHAKE_TRAUMA_BURP = 0.9
export const MEAT_GIBS_PER_BLAST = 3
export const SPARK_SPEED_MIN = 60
export const SPARK_SPEED_MAX = 150
export const SPARK_LIFT_MIN = 20
export const SPARK_LIFT_MAX = 80
export const SPARK_GRAVITY = 120
export const SPARK_DRAG_PER_SECOND = 5
export const SPARK_LIFETIME_MS = 380
export const GOO_SPEED_MIN = 40
export const GOO_SPEED_MAX = 130
export const SCORCH_SIZE_PX = 14

export const BONE_GIB_COLOR = '#efe6cf'
export const HIDE_GIB_COLOR = '#6d7f99'
export const GOO_COLOR = '#c6e83a'
export const SPARK_COLOR = '#ffb341'
export const BONE_DECAL_COLOR = '#b8ae96'
export const HIDE_DECAL_COLOR = '#4d5a6e'
export const GOO_DECAL_COLOR = '#7f9a22'
export const SCORCH_DECAL_COLOR = '#1a1210'
export const BONE_DECAL_FADED_COLOR = '#5f5a4d'
export const HIDE_DECAL_FADED_COLOR = '#353b47'
export const GOO_DECAL_FADED_COLOR = '#45521f'
export const SCORCH_DECAL_FADED_COLOR = '#241a16'

export const BARRICADE_REACH_PX = 16
export const TURRET_PLACE_REACH_PX = 10
export const TURRET_RANGE_PX = 84
export const TRAP_REACH_PX = 1.5
export const TRAP_BLAST_RADIUS = 6
export const TRAP_HIT_PULSE_MS = 140
export const TRAP_HIT_FLASH_MS = 60
export const TRAP_NOTICE_MS = 1800
export const TRAP_REPAIR_SHARE = 0.5
export const TRAP_PLACE_TRAUMA = 0.35
export const DUST_PER_PLACEMENT = 8

export const SPLINTERS_PER_HIT = 2
export const SPLINTERS_PER_CRACK = 6
export const PLANKS_PER_CRACK = 2
export const SPLINTERS_PER_BREAK = 12
export const PLANKS_PER_BREAK = 5
export const SPARKS_PER_TURRET_BREAK = 10
export const SPLINTER_SPEED_MIN = 25
export const SPLINTER_SPEED_MAX = 70
export const SPLINTER_LIFT_MIN = 30
export const SPLINTER_LIFT_MAX = 70
export const SPLINTER_LIFETIME_MS = 1400
export const PLANK_SPEED_MIN = 15
export const PLANK_SPEED_MAX = 45
export const PLANK_LIFT_MIN = 50
export const PLANK_LIFT_MAX = 90
export const PLANK_LIFETIME_MS = 2200
export const TRAP_CRACK_TRAUMA = 0.25

export const SPLINTER_COLOR = '#c99a5b'
export const PLANK_COLOR = '#8a5a2b'
export const WOOD_DECAL_COLOR = '#6b4423'
export const WOOD_DECAL_FADED_COLOR = '#3f2c1c'

export const GAME_TITLE = 'Munch Manor'
export const FEEDBACK_LINE = 'Tell whoever sent you this what you think!'

export const RESTART_GRACE_MS = 900

export const ZOMBIE_ALIVE_MAX = 20
export const PACK_WARNING_MS = 1000
export const PACK_GAP_MS = 180
export const HORDE_GAP_MS = 220
export const FADE_RELEASE_BELOW = 6
export const FADE_MAX_MS = 20000
export const PINCER_LAG_MIN_MS = 1500
export const PINCER_LAG_MAX_MS = 3000
export const DOOR_CAMP_REACH_PX = 16
export const DINNER_BELL_MS = 2200
export const RATTLE_DUST_PER_WARNING = 6
export const INTENSITY_MAX = 1
export const INTENSITY_PER_HEART = 0.35
export const INTENSITY_CLOSE_PX = 24
export const INTENSITY_PER_CLOSE_ZOMBIE_PER_SECOND = 0.12
export const INTENSITY_DECAY_PER_SECOND = 0.12
export const INTENSITY_RESTLESS = 0.4
export const RELAX_EXTEND_MAX_MS = 2000
export const QUIET_HURRY_MS = 500
export const RELAX_QUIET_MAX_MS = 500
export const RESTLESS_QUIET_MAX_MS = 1000
export const RELAX_TRICKLE_MAX = 2
export const ENDLESS_HP_PER_WAVE = 0.12
export const ENDLESS_SPEED_PER_WAVE = 0.01
export const ENDLESS_SPEED_MAX = 1.6
export const ENDLESS_ESCORTS_BASE = 90
export const ENDLESS_ESCORTS_PER_WAVE = 6
export const ENDLESS_TANKS_BASE = 4
export const ENDLESS_WAVES_PER_EXTRA_TANK = 2
export const ENDLESS_EXPLODER_WEIGHT_PER_WAVE = 0.25

// NOTE: how long each face of the Mystery Leftovers spin shows, fast then
// slow, 0.7 s in all, so the prize lands with 0.4 s of the door's 1.1 s
// opening still to go (src/fridgeReveal.ts). The spin's clicks keep time
// with it (src/audio.ts).
export const FRIDGE_SPIN_STEPS_MS: ReadonlyArray<number> = [
  40, 40, 45, 50, 55, 65, 75, 90, 110, 130,
]
