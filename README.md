# Low-Poly Arena (Stage 4: abilities)

A browser first-person shooter for you and your friends. Up to 4 players share one room on the
Container Yard map and shoot each other with 13 different weapons and 5 kinds of grenade. You can still practice alone on the shooting range.

## How to run it on your computer

1. Install Node.js (the "LTS" version) from https://nodejs.org and click through the installer.
2. Unzip the project folder somewhere (for example your Desktop).
3. Open a terminal inside that folder.
   - Windows: open the folder, click the address bar, type `cmd`, press Enter.
   - Mac: right-click the folder and choose "New Terminal at Folder".
4. Type `npm install` and press Enter. **Do not skip this.** The game needs one small add-on (called `ws`) and `npm start` fails without it.
5. Type `npm start` and press Enter. The terminal prints a few addresses.
6. Open Chrome, Edge or Firefox and go to http://localhost:3000
7. Type a name, click JOIN GAME. To stop the game server, press Ctrl+C in the terminal.

The page needs internet once per load, because the 3D library (Three.js) comes from a CDN.

## Playing with friends

- **Same Wi-Fi or network:** after `npm start`, the terminal prints "Friends on the same Wi-Fi or network can join at"
  and one or more addresses like `http://192.168.1.20:3000`. Your friends open that address in their browser.
  If it does not load for them, your computer's firewall is probably blocking it. Allow Node.js when it asks.
- **Over the internet:** the server has to run on a public host (for example Render's free plan: build command
  `npm install`, start command `npm start`). I have not tested a real host yet, because I cannot reach one from
  here. We will do that together at the end. Free hosts go to sleep when nobody plays, so the first load can take about a minute.
- **Testing alone:** open the game in two separate browser windows (for example Chrome and Edge), join with a different
  name in each. Only the window you are using plays smoothly; a window in the background slows down.
- **Fake lag:** open `http://localhost:3000/?lag=150` to pretend you have 150 ms ping. Good for checking how it feels on a slow connection.

## Controls

Every key below can be changed in the menu: under **Controls**, click a key and press the new one (a mouse button
works too, and Esc cancels). If you pick a key that is already used, the two actions swap. **Reset keys to default**
puts everything back. Your choices are saved in the browser.

| Action | Default key |
| --- | --- |
| Move | W A S D |
| Look | Mouse |
| Jump | Space |
| Crouch (hold) | C |
| Sprint (hold, moving forward) | Shift |
| Fire (hold for automatic) | Left mouse |
| Aim down sights | Right mouse |
| Reload | R |
| Primary / secondary / melee | 1, 2, 3 |
| Cycle weapons | Mouse wheel (fixed) |
| Quick knife | V |
| Throw a grenade | G (hold to aim, release to throw). Key 4 does the same. |
| Lean left / right (hold) | Q / E |
| Use your ability | F |
| Bunny hop (melee out) | C + Space + Shift together, moving forward |
| Scoreboard (hold, online) | Tab |
| FPS, ping and network info | F3 |
| Show or hide the minimap | M |
| Menu | Esc (fixed, you stay in the game while it is open) |
| Practice range only: take damage, refill ammo | H, B (fixed) |

## Weapons

Pick yours with the **Loadout** button in the menu. Everything is unlocked for now. In practice mode a new loadout
takes effect at once. Online, it takes effect the next time you respawn.

| Weapon | Slot | Rarity | Damage | Fire rate | Ammo (mag / reserve) | Reload |
| --- | --- | --- | --- | --- | --- | --- |
| AR-7 Assault Rifle | Primary | Common | 22 | 600 rpm, auto | 30 / 120 | 2.2 s |
| Viper SMG | Primary | Common | 16 | 900 rpm, auto | 35 / 140 | 1.8 s |
| Breaker Shotgun | Primary | Rare | 8 pellets x 9 | 70 rpm, pump | 6 / 30 | 0.6 s per shell (a click interrupts it) |
| Hammer LMG | Primary | Epic | 18 | 700 rpm, auto | 100 / 200 | 5.0 s |
| Longshot Sniper | Primary | Epic | 90, a headshot always kills | 45 rpm, bolt | 5 / 20 | 3.0 s |
| Nova Carbine | Primary | Mythic | 24 per bolt | 3-round burst, no recoil | 30 / 90 | 2.4 s |
| Rail Cannon | Primary | Legendary | 85 (170 on the head, kills) | 1 shot every 2 s, goes through 1 wall | 3 / 9 | 3.2 s |
| Sidekick Pistol | Secondary | Common | 20 | 400 rpm, semi | 12 / 60 | 1.3 s |
| Stinger Machine Pistol | Secondary | Rare | 11 | 800 rpm, auto | 20 / 80 | 1.5 s |
| Cannon Revolver | Secondary | Epic | 55 (two body shots kill) | 120 rpm, semi | 6 / 24 | 2.4 s |
| Combat Knife | Melee | Common | 40, 100 from behind | 0.5 s swing, 2 m | none | none |
| Machete | Melee | Rare | 45, 100 from behind | 0.55 s swing, 2.3 m | none | none |
| Energy Blade | Melee | Legendary | 55, 100 from behind | 0.4 s swing, 2.3 m | none | none |

The Nova Carbine and the Rail Cannon are the two extra weapons I made up (the brief asked for one Mythic and one
Legendary). Headshots do 1.5 times damage (2 times for the Rail Cannon). Damage drops with distance for most guns.
You start every life with full magazines and full reserves in all three weapons. Reloading is cancelled if you switch weapons.

**Balance notes.** The damage, fire rate, ammo and reload numbers above come straight from your brief and did not change.
What I tuned: moving now ruins your accuracy (walking widens the spread to roughly 3 times the standing size, sprinting
more, and aiming only helps a little, so you really have to stop to hit far targets). I also softened the recoil of the
Breaker, Hammer, Longshot, Rail Cannon and Cannon Revolver, and made the Nova Carbine hit a bit harder (28 per bolt,
so it kills in about 0.5 s up close). A close-range kill takes about 0.4 s with the AR-7 and Viper, 0.5 to 0.7 s with
the Hammer, Nova, Cannon, Sidekick and Stinger, 2 shots for the shotgun, sniper and rail.

**Moving faster with light weapons.** Your speed depends on what you hold (walking 5 m/s, sprinting 7.5 m/s with the AR-7):

| Holding | Speed |
| --- | --- |
| Combat Knife | +8% |
| Energy Blade | +7% |
| Machete | +6% |
| Sidekick, Stinger, Viper | +4% |
| Cannon Revolver | +3% |
| AR-7, Nova Carbine | normal |
| Breaker Shotgun | -8% |
| Longshot Sniper | -15% |
| Rail Cannon | -15% |
| Hammer LMG | -20% |

**Bunny hop.** With any melee weapon in your hands, hold **C, Space and Shift together while moving forward**. You
jump again the moment you land, you keep your speed, and you gain a little speed on every hop, up to 11 m/s (a normal
sprint is 7.5, or 8.1 with the knife). You stay crouched, so you are a smaller target. Let go of any of the three
keys and it stops. Guns cannot bunny hop.

## Grenades

Pick one type in the **Loadout** screen (the Grenade column). You carry **2** and get **1 back every 30 seconds**
(up to 2). **Hold G** to aim: one straight line shows where it is going and a dot marks where it first lands. **Release G**
to throw (key 4 works the same way). Grenades bounce off walls and the floor, and roll to a stop. You can hurt yourself
with your own grenade. A red grenade icon appears on your screen when a dangerous grenade is within about 14 m (7 m for
your own, once it has been out for a second), at the edge of the screen with an arrow when it is off to the side or
behind you. It pulses when you are inside its blast range.

| Grenade | Rarity | What it does |
| --- | --- | --- |
| Frag | Common | Explodes after 2 s (a little faster than the brief's 2.5 s, as you asked). 70 damage in the centre, fading to 0 at 5 m. Walls block the blast. |
| Flash | Rare | Goes off after 1.3 s. Blinds the screen white for up to 3 s: longer when you are close and looking at it, much shorter with your back turned. Walls block it. Nothing beyond 20 m. |
| Smoke | Rare | Goes off after 1.2 s. A thick cloud of 4 m radius for 8 s that blocks your view. It does not stop bullets. |
| Sticky | Epic | Sticks to walls, floors and players. Goes off 1.5 s after it sticks (or after 5 s in the air). 80 damage to the player it is stuck to, fading to 0 at 4 m for others. |
| Incendiary | Mythic | Goes off after 1.2 s. Fire in a 4 m radius for 5 s. Walking into it hurts at once (12, which is 2 ticks), then 6 every half second (12 per second) while you stay in it. Step out and back in and you take the 2 ticks again. Walls block the fire. |

The fuse times for Flash, Smoke and Incendiary, the 20 m flash range, the blast radius of the Sticky and the way the
throw works (17 m/s, slightly upward) are my own choices, because the brief did not give them.

## Abilities

Pick one in the **Loadout** screen (the Ability column). Press **F** to use it. The ring at the bottom left shows the cooldown
and turns bright when it is ready. Everything is unlocked for testing. All twelve abilities are in.

| Ability | Rarity | What it does | Cooldown |
| --- | --- | --- | --- |
| Dash | Common | A quick burst of speed (16 m/s for 0.2 s) in the direction you are moving, or forward if you stand still. | 8 s |
| Heal Pulse | Common | Restores 25 HP over 3 s. Any damage cancels it. | 30 s |
| Air Dash | Rare | A burst in mid-air that also floats you across small gaps. Only works in the air (and costs nothing if you press it on the ground). | 10 s |
| Armor Plate | Rare | Absorbs the next 30 damage within 10 s. | 35 s |
| Scan Pulse | Rare | Shows enemies within 30 m through walls (purple glow) for 3 s. | 25 s |
| Grapple Hook | Epic | Fires a hook where you look (up to 25 m, at a wall or crate) and pulls you there. Aim a bit above a ledge to swing up onto it. Pointing at the sky or floor does nothing and costs nothing. | 12 s |
| Shield Bubble | Epic | Puts a dome (3 m radius) about 2.5 m in front of you for 6 s. Bullets from outside stop at it; bullets from inside and from other people inside go through. Grenades are not blocked. | 40 s |
| Damage Surge | Epic | +30% damage for 8 s with guns, melee and grenades (not on yourself). | 40 s |
| Proximity Mine | Epic | Lays a mine at your feet (max 2 at a time, a third one removes your oldest). It arms after 1 s. Enemies who come within 2.5 m set it off: 60 damage within 3 m (needs line of sight). Everyone can see it. It never hurts you. | 20 s |
| Phase Cloak | Legendary | You are almost invisible for 5 s (no name tag). Shooting, swinging or throwing shows you fully for 1 s. A Scan Pulse sees through it. | 45 s |
| Orbital Strike | Legendary | Marks the spot you look at (up to 60 m). After 2 s it deals 100 damage in a 6 m radius to everyone there, including you. Everyone sees the red marker and beam, so people can run. | 90 s |
| Second Wind | Legendary | Passive, no button. The next time you would die, you survive with 50 HP and a short speed boost (+30% for 3 s). It re-arms 60 s later. | 60 s |

Other players can see your abilities: a blue shell for Armor Plate, a rising green ring for Heal Pulse, an orange glow for
Damage Surge, a gold ring for Second Wind's boost, dash streaks, a grapple rope, and a ring when you scan. Damage Surge,
Armor Plate and Heal Pulse are decided by the server, and the dashes and the grapple are predicted by your browser the
same way as walking, so they feel instant.

## Godzilla mode (secret)

Join the game with the name **godzilla** (any capitals) and you become Godzilla. Only one player can be Godzilla at a
time; a second "godzilla" just becomes "godzilla 2". Everyone else sees a huge green low-poly monster with a boss health
bar at the top of the screen.

| Move | Key | What it does |
| --- | --- | --- |
| Fire Breath | hold left mouse | A cone of fire 20 m long in front of you, about 60 damage per second. You have 3.5 s of fire, and it refills slowly (0.45 s per second) while you are not breathing. Walls block it. |
| Grab and Eat | right mouse | Grabs the nearest player in front of you (within 4.5 m) and holds them up in your hand. After 1.3 s you bite: they are eaten and you heal 80. 6 s cooldown. They cannot move, jump or shoot while held. If nobody is close you just swipe the air (0.8 s). |
| Stomp | F (your ability key) | After a short wind-up (0.35 s) a shockwave hits everyone within 9 m (35 damage close up, 18 at the edge). Jump over it to dodge. 4 s cooldown. |
| High jump | Space | About 4.3 m high (a normal jump is 1.2 m). |

Godzilla has 400 HP, a body 2.4 times bigger (the hit box too, with a bigger head for headshots), cannot crouch, and has no guns or
grenades. He respawns as Godzilla. Everything has animations: walking, jumping, landing, the breath (jaw opens, fins glow
blue, flames), the swipe, the grab, the bite, the stomp (leg up, then slam with a ring and dust) and a roar when he arrives.
Other players who get grabbed struggle in his hand.

## Leaning

Hold **Q** or **E** to lean left or right (like Rainbow Six Siege). Your view moves about 35 cm to the side and tilts a
little, and your shots come from the leaned position. Other players see you lean, and your head really moves: a shot
aimed at where your head was misses. You cannot lean while sprinting or in the air, and you cannot lean into a wall (it
stops before your head goes through). You can lean while crouched. The ability key is F (the brief said Q, but Q is lean now). You can change any key in the menu.

## Test checklist (two players, about 15 minutes)

Godzilla checks (new, needs two browsers):

- [ ] One player joins as "godzilla". The other sees a big green monster and a boss bar at the top. The Godzilla player sees claws and a jaw instead of a gun, and a panel with FIRE BREATH, GRAB AND EAT and STOMP.
- [ ] Hold left mouse: flames come out and hurt the other player in front. The blue FIRE bar drains and refills slowly.
- [ ] Right mouse next to the other player: they are lifted into his hand (a red GRABBED tag, they cannot walk). About a second later they are eaten and Godzilla heals.
- [ ] Press F: Godzilla lifts a leg, then stomps. A ring and dust spread out, the screen shakes, nearby players lose health.
- [ ] Space: a very high jump with a thud on landing.
- [ ] Shooting Godzilla hurts him (the boss bar goes down). Headshots count extra.

Stage 4 Part B checks:

- [ ] Shield Bubble: a blue dome appears in front of you for 6 s. A friend shooting at you from outside hits the dome (ripple), not you. You can shoot out of it.
- [ ] Proximity Mine: press F, a mine with a blinking lamp lies at your feet. A friend walking close after 1 s takes 60 and it explodes. A third mine removes your oldest. It never hurts you.
- [ ] Phase Cloak: you almost vanish for others (no name tag). Shooting shows you for 1 s. It ends after 5 s. A "CLOAKED" tag shows for you.
- [ ] Orbital Strike: look at the floor or a wall and press F. A red ring and beam show for everyone. After 2 s it explodes (100 damage within 6 m). Looking at the sky does nothing.
- [ ] Ability column in the loadout now has 12 abilities.

Stage 4A checks:

- [ ] Loadout > Ability column.  Pick one. The ring at the bottom left shows its name, a cooldown and the F key.
- [ ] Dash: hold W and press F. You shoot forward, the view widens and speed lines appear. A second press during the cooldown does nothing.
- [ ] Heal Pulse (after losing some health): green glow and a "HEALING" tag, health climbs, and getting hit stops it.
- [ ] Armor Plate: an "ARMOR 30" tag. The next 30 damage does nothing to your health. Other players see a blue shell.
- [ ] Damage Surge: a "SURGE +30%" tag and your hits do 30% more.
- [ ] Scan Pulse: a purple ring expands and enemies within 30 m glow through walls for 3 s.
- [ ] Grapple Hook: aim at a container or wall and press F. A rope and you get pulled there. Aim at the sky: nothing happens.
- [ ] Air Dash: nothing on the ground. Jump, then press F while moving: you float sideways.
- [ ] Second Wind: the box says ARMED. Take a deadly hit and you live with 50 HP. It then counts down 60 s.
- [ ] Aiming down sights: the stock and arms no longer block the view (just the sights and a thin gun).

Stage 3D checks:

- [ ] Hold G: one straight line to a dot where it will land. (No bounce line and no radius circle, on purpose.) 
- [ ] Walk into an incendiary fire: you lose 12 at once, then 6 every half second. Step out and back in: 12 again.
- [ ] The smoke is a soft, billowing cloud and the fire has flames, sparks and dark smoke.
- [ ] Firing a rifle: the view climbs smoothly and drifts gently, with no sudden jumps.
- [ ] The sniper, Rail Cannon and Hammer LMG make you clearly slower.
- [ ] Hold Q or E: you lean (view moves, picture tilts). You cannot lean into a wall. Another player sees you lean.
- [ ] Have a friend throw a grenade near you: a red grenade icon with a distance shows on your screen, at the edge with an arrow when it is behind you.

Stage 3C checks:

- [ ] Loadout screen: a Grenade column with 5 types. Pick one, hover to see a model, stats and description.
- [ ] Bottom right shows your grenade (name, 2 dots, a "+1 in 30 s" timer after you throw). A third throw is refused.
- [ ] Hold G: a coloured arc and landing ring appear, and a grenade is raised in your hand. Release: it flies and bounces.
- [ ] Frag: stand next to the practice dummies and throw. A wall between you and the blast protects you. Your own frag hurts you.
- [ ] Flash: throw it close and look at it (white screen, ringing), then try with your back turned (much shorter).
- [ ] Smoke: a grey cloud grows. Stand inside it and the screen goes grey. It disappears after about 8 s.
- [ ] Sticky: throw it at another player. It sticks and follows them, then goes off.
- [ ] Incendiary: fire on the ground, and you take damage while you stand in it.
- [ ] Online, the kill feed says which grenade got a kill, and "blew themselves up" if it was their own.
- [ ] Menu > Controls: the grenade key can be rebound.

Stage 3B checks:

Stage 3B checks (new):

- [ ] Menu > Controls: click a key, press another, and the game uses it. Try swapping two keys. Reset puts them back.
- [ ] Walk while shooting: the crosshair opens wide and shots scatter. Stop: it tightens. Sprinting is the worst. Crouching helps.
- [ ] Hold crouch: the camera eases down and the gun sits lower. Another player's character bends at the knees and leans forward.
- [ ] A scoped sniper is hopeless while walking, but dead accurate standing still.
- [ ] The weapons look better in hand, while aiming, and in the loadout screen.

Stage 3 checks:

- [ ] Menu > **Loadout**: 13 weapons in three columns, each with a rarity colour. Hovering shows a spinning 3D model and stat bars. Click to equip.
- [ ] In practice, try every weapon on the dummies. Each one looks, sounds and feels different.
- [ ] Keys 1, 2, 3 and the mouse wheel switch weapons. The bar at the bottom shows what you carry.
- [ ] Press R, then switch weapons: the reload is cancelled. Switching back does not finish it.
- [ ] Breaker Shotgun: loads one shell at a time. Click while reloading to shoot instead.
- [ ] Longshot Sniper and Rail Cannon: right click shows a scope. A sniper headshot kills in one hit.
- [ ] Nova Carbine: one click fires a quick burst of 3 with no kick.
- [ ] Knife: V does a quick swing and puts your gun back. Hit someone from behind for an instant kill.
- [ ] Knife out: you run a bit faster than with the rifle. Hold C + Space + Shift and keep moving forward: you should hop along and speed up.
- [ ] Two players with different loadouts: you can see the other player holding the right weapon, and hear different shots.
- [ ] Change your loadout while online: it applies after your next respawn.

Stage 2 checks (still apply):

- [ ] Both players join with different names. Each sees the other as a coloured figure with a name tag.
- [ ] Walking around feels instant and smooth. The other player's movement looks smooth too (not jumpy).
- [ ] Shooting the other player shows a hit marker and a damage number for you, and a red flash and sound for them.
- [ ] Headshots do more damage (33 against 22 with the AR-7).
- [ ] About 5 body hits eliminate a player. The kill feed shows "Name > Name", the victim sees "ELIMINATED" with a
      respawn countdown, and they come back after 3 seconds at a spawn far from the other player.
- [ ] Holding Tab shows the scoreboard with kills and deaths. The numbers under the minimap match.
- [ ] Bullets stop at walls and containers. You cannot shoot through them.
- [ ] You can hear the other player's shots, quieter when far away.
- [ ] Esc opens the menu and you stay in the game (the other player can still see you). Resume works. Leave game goes back to the menu.
- [ ] Press F3: ping looks sensible, and "correction" stays near 0 cm while walking.
- [ ] A 5th player trying to join sees "This room is full".
- [ ] Practice alone still works (target dummies, H and B keys).
- [ ] Try `?lag=150`: movement still feels instant, shots still land where you aimed.

## What was simplified or left for later

- Godzilla: he moves with the normal player body, so he walks through the same gaps as everyone else (and his picture can poke
  into walls and containers). Fire breath is not stopped by Shield Bubbles or smoke. The fire picture goes through walls
  (the damage does not). It only works online, not in practice mode, because the name comes from the join screen.

- One room only (everyone who joins is in it). Rooms with codes come later.
- Players walk through each other (no player-to-player bumping). This keeps movement smooth for everyone.
- Shield Bubble only blocks bullets (not grenades or melee), and only from outside. Proximity Mines are visible to everyone,
  including the enemy. Orbital Strike also hurts the person who called it. Domes, mines and strikes are dropped if their
  owner dies or leaves (a strike already called in still lands). The ability glows for other
  players are simple shapes. Heal Pulse, Armor Plate, Damage Surge and Scan Pulse are timed effects kept on the server;
  if the connection drops they are lost. Scan Pulse shows players, not grenades. The grapple needs a wall or crate in range.
- Aiming view: the stock and your arms are hidden while aiming so the view is clear. Optical scopes and attachments (red dot,
  2x, 4x) are not in yet; the brief puts them in the customisation stage.
- Lean: only the head hit box moves when leaning (the rest of the body stays where it was), and your own gun stays
  upright on screen. Lean for other players is rounded to two decimals.
- Recoil is eased in over about 0.1 s so fast fire feels smoother. The Recoil bar numbers did not change.
- Grenades: someone who joins while a smoke cloud or fire is already burning will not see it (new clouds and fires are
  fine). Grenades do not make a bounce sound, and other players do not visibly hold a grenade when they throw.
  Smoke only blocks the view, not bullets. Abilities, maps, voting, the economy and crates come in later stages.
- Everything is unlocked in the loadout screen for testing. There are no attachments yet.
- Weapon models are still built from simple boxes (just with more detail now). Reload and swing animations are basic. Other players' weapons do not animate when they reload.
- Keybinds: the mouse wheel, Esc, and the practice keys H and B cannot be changed. There is one key per action (no second binding).
- Melee hits are resolved on the server with a simple arc in front of you (about 90 degrees wide) and a wall check.
  Backstabs count when you are behind the other player and facing roughly the same way.
- The scope is a plain overlay, and no zoom levels or attachments exist.
- The server decides movement, ammo, damage, deaths and respawns. Where you are *looking* comes from your browser
  (normal for this kind of game), so a determined cheater could remove their own recoil.
- A freshly respawned player cannot be hurt for 1.5 seconds. There is no sign of this on screen yet.
- Other players' footsteps are not played yet, and there is no chat or voice.
- The game does not end: kills and deaths just keep counting while the server runs.
- If the connection drops, you are sent back to the menu with a message. There is no automatic reconnect.

## Project layout

- `server.js`: web server, plus the WebSocket connection at `/ws`.
- `server/room.js`: the game room (the server-side rules). `server/ws.js` connects real sockets to it.
- `shared/`: code and data used by both the game and the server: `maps.js`, `weapons.js`, `physics.js`, `combat.js`.
- `public/`: the game in the browser (page, styles, scripts in `js/`).
- `tests/`: automatic checks. Run them with `npm test`.
- `public/js/weaponModels.js`: every weapon model. `public/js/loadout.js`: the loadout screen. `public/js/keybinds.js`: rebindable keys.

## How the multiplayer works (short version)

Your browser sends the server your inputs 60 times a second. The server runs the same movement and shooting
code as your browser (`shared/`) and sends back the true state 30 times a second. Your browser predicts its own
movement so it feels instant, and quietly corrects itself if the server disagrees. Other players are drawn about
0.1 seconds in the past so they move smoothly. When you fire, the server checks the shot against where the
other players were on your screen at that moment ("lag compensation"), so shots land where you aimed.
