$ErrorActionPreference = "Stop"

throw "PET_HUMAN_SCHEME_RETIRED: 旧宠物人化方案已撤回，禁止恢复中间图"

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$out = Join-Path $root "tools/imagegen/out/humanization-v1"
$twoStage = Join-Path $out "probes/two-stage"
$comparison = Join-Path $out "probes/comparison"
$masters = Join-Path $out "masters/candidates"

New-Item -ItemType Directory -Force -Path $twoStage, $comparison | Out-Null

$sourceRoot = "C:/Users/Administrator/.codex/generated_images/01a0146f-4074-7553-86da-d32b9776d71a"
$copies = @{
  "exec-1db8c040-3969-4d51-b583-213d78c0d6e4.png" = (Join-Path $twoStage "human-breezy-fence_tuxedo-cat_9x16_v01.png")
  "exec-5199b863-968d-419f-a829-9bdc0f08e9c7.png" = (Join-Path $comparison "human-breezy-fence_tuxedo-cat_direct_9x16_v01.png")
  "exec-85293619-c6d5-4aee-ac65-7257871520b1.png" = (Join-Path $twoStage "human-color-splash_parrot_9x16_v01.png")
  "exec-ef3f81b3-3689-41a3-8cca-f467e5ef0de7.png" = (Join-Path $twoStage "human-jade-garden_rabbit_9x16_v01.png")
  "exec-7fb15abd-309b-4268-9977-76e112ad6d20.png" = (Join-Path $twoStage "human-moonlit-fantasy_ragdoll-cat_9x16_v01.png")
  "exec-37e72283-308c-42c1-8253-be9207c6ef15.png" = (Join-Path $twoStage "human-snow-scarf_husky-dog_9x16_v01.png")
  "exec-beeb9861-9934-45d7-9312-485af66146f8.png" = (Join-Path $twoStage "human-hanfu-summer_corgi-dog_9x16_v01.png")
  "exec-250b483d-acbe-49c4-ba1f-3a2b4e015890.png" = (Join-Path $twoStage "human-urban-collar_black-cat_9x16_v01.png")
  "exec-64d8e09d-748a-4099-a03b-e4886a3e9fa0.png" = (Join-Path $twoStage "human-evening-blazer_golden-dog_9x16_v01.png")
  "exec-72ee8123-9e71-4eae-b39c-f48a1890ff3b.png" = (Join-Path $twoStage "human-flower-daylight_hamster_9x16_v01.png")
  "exec-12e8ab31-5214-4c88-a7e6-22d6fa7bf664.png" = (Join-Path $twoStage "human-black-tee_black-lab-dog_9x16_v01.png")
  "exec-a720c15c-5ea4-4023-a657-0ee3e246d119.png" = (Join-Path $twoStage "human-sunlit-short-hair_poodle-dog_9x16_v01.png")
  "exec-0554390d-d19f-4c8a-b732-a7fc325088d7.png" = (Join-Path $twoStage "human-tailored-suit_blue-british-cat_9x16_v01.png")
  "exec-33d70145-ec98-4840-923d-b82314729eaf.png" = (Join-Path $masters "human-moonlit-fantasy_9x16_v02.png")
}

foreach ($entry in $copies.GetEnumerator()) {
  $source = Join-Path $sourceRoot $entry.Key
  if (-not (Test-Path -LiteralPath $source)) { throw "Missing generated image: $source" }
  if (Test-Path -LiteralPath $entry.Value) { throw "Refusing to overwrite: $($entry.Value)" }
  Copy-Item -LiteralPath $source -Destination $entry.Value
}

Write-Output "Archived $($copies.Count) humanization artifacts."
