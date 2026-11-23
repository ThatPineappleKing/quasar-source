// Built-in background photos (mountains), shown behind the clock when no tab is
// open. All from Unsplash under the Unsplash licence (free to use, no permission
// needed); credits are shown in Settings when you hover over a photo.
window.ArchBackgrounds = [
  { id: 'm01', title: 'Lake and mountain', by: 'Tobias Keller', link: 'https://unsplash.com/photos/73F4pKoUkM0' },
  { id: 'm02', title: 'Rolling mountain range', by: 'simon', link: 'https://unsplash.com/photos/twukN12EN7c' },
  { id: 'm03', title: 'Layered ridges under an orange sky', by: 'Sven Pieren', link: 'https://unsplash.com/photos/ibikgDapcp4' },
  { id: 'm04', title: 'Peak at sunrise', by: 'Gantavya Bhatt', link: 'https://unsplash.com/photos/mmcSaJrRuCM' },
  { id: 'm05', title: 'Wildflowers by a glacial lake', by: 'Pascal Debrunner', link: 'https://unsplash.com/photos/d7Bvh_2cFnA' },
  { id: 'm06', title: 'Mountains in morning mist', by: 'Paul Earle', link: 'https://unsplash.com/photos/xJ2tjuUHD9M' },
  { id: 'm07', title: 'Yosemite cliffs and waterfall', by: 'Aniket Deole', link: 'https://unsplash.com/photos/M6XC789HLe8' },
  { id: 'm08', title: 'Snowy peak at night', by: 'Renato Muolo', link: 'https://unsplash.com/photos/evJh_sTH0b8' },
  { id: 'm09', title: 'Ranges under a purple and pink sky', by: 'Štefan Štefančík', link: 'https://unsplash.com/photos/-g7axSVst6Y' },
  { id: 'm10', title: 'Island, lake and mountains', by: 'Neven Krcmarek', link: 'https://unsplash.com/photos/pOWBHdgy1Lo' },
  { id: 'm11', title: 'Valley with a winding road and cabin', by: 'Intricate Explorer', link: 'https://unsplash.com/photos/L6-l45Y_om0' },
  { id: 'm12', title: 'Forest and snowy mountains', by: 'Hendrik Kespohl', link: 'https://unsplash.com/photos/1YQDhLtB9yU' },
].map(b => ({ ...b, file: `backgrounds/${b.id}.jpg`, thumb: `backgrounds/${b.id}-thumb.jpg` }));
