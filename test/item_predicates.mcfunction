# Item Predicate Test Cases

# Basic wildcards
execute if items block 0 0 0 container.0 * run say any item
execute if items block 0 0 0 container.0 *[] run say any item empty test

# Wildcard with component existence
execute if items block 0 0 0 container.0 *[minecraft:rarity] run say has rarity
execute if items block 0 0 0 container.0 *[minecraft:damage] run say has damage
execute if items block 0 0 0 container.0 *[minecraft:custom_name] run say has name

# Wildcard with exact value match
execute if items block 0 0 0 container.0 *[minecraft:rarity="common"] run say common
execute if items block 0 0 0 container.0 *[minecraft:damage=0] run say undamaged
execute if items block 0 0 0 container.0 *[minecraft:count=64] run say full stack

# Wildcard with sub-predicate (~)
execute if items block 0 0 0 container.0 *[count~{min:1}] run say at least 1
execute if items block 0 0 0 container.0 *[count~{max:32}] run say half stack or less
execute if items block 0 0 0 container.0 *[count~{min:1,max:16}] run say 1 to 16

# Negation (!)
execute if items block 0 0 0 container.0 *[!minecraft:damage] run say no damage component
execute if items block 0 0 0 container.0 *[!minecraft:rarity] run say no rarity

# OR operator (|)
execute if items block 0 0 0 container.0 *[minecraft:rarity="rare"|minecraft:rarity="epic"] run say rare or epic

# AND operator (,)
execute if items block 0 0 0 container.0 *[minecraft:damage,minecraft:max_damage] run say damageable

# Complex combinations
execute if items block 0 0 0 container.0 *[!minecraft:damage|minecraft:damage=0,count~{min:1}] run say undamaged with count

# Resource location as item type
execute if items block 0 0 0 container.0 minecraft:diamond_sword[minecraft:damage=0] run say pristine sword
execute if items block 0 0 0 container.0 diamond_sword[minecraft:enchantments] run say enchanted sword

# Tag reference as item type
execute if items block 0 0 0 container.0 #minecraft:planks[] run say any plank
execute if items block 0 0 0 container.0 #minecraft:swords[minecraft:damage] run say damaged sword

# NBT-style component values
execute if items block 0 0 0 container.0 *[minecraft:custom_name='{"text":"Special"}'] run say named Special
execute if items block 0 0 0 container.0 *[minecraft:lore=['{"text":"Line 1"}']] run say has lore

# Bundle contents
execute if items block 0 0 0 container.0 *[minecraft:bundle_contents] run say is bundle with contents

# Container items
execute if items block 0 0 0 container.0 *[minecraft:container] run say has container component
