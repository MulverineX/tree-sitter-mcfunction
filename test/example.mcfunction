# This is a comment
#> Block header comment

# Simple commands
say Hello World
tellraw @a {"text":"Welcome!","color":"green"}

# Execute chain with line continuation
execute as @a[gamemode=survival,distance=..10] \
    at @s \
    run particle minecraft:flame ~ ~1 ~

# Macros
$say $(message)
$execute if score $(target) $(objective) matches $(range) run function $(func)

# Scoreboard
scoreboard players set @s myScore 100
scoreboard players operation @s total += @s current

# Data commands
data merge entity @s {CustomName:'{"text":"Named"}',NoGravity:1b}

# Function with tag
function #minecraft:tick

# Numbers and ranges
execute if score @s obj matches 1..10 run say in range
execute if score @s obj matches ..5 run say max 5
execute if score @s obj matches 10.. run say min 10
