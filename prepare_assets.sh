#!/usr/bin/env sh

# First get the base assets
git clone https://github.com/bill-ion/tikzjax

cd tikzjax

# Generate and encode the fonts
# NOTE: In comparison to tikzjax, the fonts are not patched.
sed -i '/github/d' package.json
npm i
npx gulp download-fonts
npx gulp install-fonts
sed -i '/rmdir/d' encodeFonts.js
node encodeFonts.js

cp -p dist/fonts.css ../client/public/fonts.css

cd tex_files
gunzip *.gz

# Add the additional math fonts
curl -L -O https://mirrors.ctan.org/fonts/cm/tfm.zip
unzip tfm.zip
cp tfm/* ./
curl -L -O https://mirrors.ctan.org/fonts/amsfonts.zip
unzip amsfonts.zip
cp amsfonts/tfm/* ./
rm -rf tfm amsfonts


# Create a tar archive of everything
tar -czf tex_files.tar.gz *

cd ../..

cp -p tikzjax/tex_files/tex_files.tar.gz server/rust_tikz/src/assets/tex_files.tar.gz

cd tikzjax

gunzip tex.wasm.gz
gunzip core.dump.gz

cp -p tex.wasm ../server/rust_tikz/src/assets/tex.wasm
cp -p core.dump ../server/rust_tikz/src/assets/core.dump
