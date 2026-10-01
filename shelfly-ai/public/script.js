const STORAGE_KEY = 'shelfly_products_v3';
const LEGACY_STORAGE_KEY = 'shelfly_products_v2';
const SAVED_KEY = 'shelfly_saved_count_v3';
const RECIPES_KEY = 'shelfly_ai_recipes_v1';
const CATALOG_KEY = 'shelfly_product_catalog_v1';

const state = {
  products: loadProducts(),
  catalog: loadCatalog(),
  saved: Number(localStorage.getItem(SAVED_KEY) || 0),
  stream: null,
  detector: null,
  scanning: false,
  currentPage: 'dashboard'
};

const categoryEmoji = {
  dairy: '🥛', cheese: '🧀', eggs: '🥚', fruit: '🍎', vegetables: '🥕', meat: '🥩',
  grains: '🍚', snacks: '🍪', frozen: '🧊', beverage: '🥤', other: '🍴'
};

const storageTips = [
  ['🥛', 'Dairy', 'Keep milk and other dairy products refrigerated and follow the package temperature instructions.'],
  ['🧀', 'Cheese', 'Refrigerate cheese and keep it wrapped or in a sealed container to reduce drying and odors.'],
  ['🥚', 'Eggs', 'Keep eggs refrigerated when the package requires it and avoid frequent temperature changes.'],
  ['🍎', 'Fruit', 'Storage depends on the fruit. Separate ethylene-sensitive produce and follow any package guidance.'],
  ['🥕', 'Vegetables', 'Many vegetables last longer refrigerated in appropriate produce bags or containers.'],
  ['🍚', 'Grains & pantry', 'Keep dry foods sealed, dry and away from heat, moisture and direct sunlight.'],
  ['🥩', 'Meat', 'Keep raw meat refrigerated or frozen according to the package instructions and prevent cross-contamination.'],
  ['🧊', 'Frozen food', 'Maintain the freezer temperature and avoid repeatedly thawing and refreezing food.'],
  ['🥪', 'Opened food', 'Once opened, record the opening date and follow the package storage and use instructions.']
];

const $ = (id) => document.getElementById(id);

function loadProducts() {
  const keys = [STORAGE_KEY, LEGACY_STORAGE_KEY];

  for (const key of keys) {
    try {
      const data = JSON.parse(localStorage.getItem(key) || '[]');
      if (Array.isArray(data) && data.length) return data;
    } catch {
      // Try the next localStorage version.
    }
  }

  return [];
}

function saveProducts() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.products));
}

function loadCatalog() {
  try {
    const data = JSON.parse(localStorage.getItem(CATALOG_KEY) || '{}');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function saveCatalog() {
  localStorage.setItem(CATALOG_KEY, JSON.stringify(state.catalog));
}

function rememberProduct(product) {
  const barcode = String(product?.barcode || '').replace(/\D/g, '');
  if (!barcode || !product?.name) return;

  state.catalog[barcode] = {
    barcode,
    name: product.name,
    brand: product.brand || '',
    category: product.category || 'other',
    storage: product.storage || 'Refrigerator',
    afterOpening: product.afterOpening ?? null,
    image: product.image || '',
    source: product.source || 'Shelfly memory',
    lastUsedAt: new Date().toISOString()
  };
  saveCatalog();
}

function findKnownProduct(barcode) {
  const cleaned = String(barcode || '').replace(/\D/g, '');
  if (!cleaned) return null;

  if (state.catalog[cleaned]?.name) return state.catalog[cleaned];

  const previous = state.products.find((product) => String(product.barcode || '').replace(/\D/g, '') === cleaned);
  if (previous?.name) {
    rememberProduct(previous);
    return state.catalog[cleaned];
  }

  return null;
}

function seedCatalogFromInventory() {
  let changed = false;
  for (const product of state.products) {
    const barcode = String(product.barcode || '').replace(/\D/g, '');
    if (!barcode || !product.name) continue;
    const current = state.catalog[barcode];
    if (!current || !current.name) {
      state.catalog[barcode] = {
        barcode,
        name: product.name,
        brand: product.brand || '',
        category: product.category || 'other',
        storage: product.storage || 'Refrigerator',
        afterOpening: product.afterOpening ?? null,
        image: product.image || '',
        source: product.source || 'Shelfly memory',
        lastUsedAt: new Date().toISOString()
      };
      changed = true;
    }
  }
  if (changed) saveCatalog();
}

function uid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `food-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function todayISO() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function daysUntil(dateString) {
  if (!dateString) return null;
  const today = new Date(`${todayISO()}T00:00:00`);
  const target = new Date(`${dateString}T00:00:00`);
  return Math.round((target - today) / 86400000);
}

function statusFor(product) {
  const days = daysUntil(product.expirationDate);
  if (days !== null && days < 0) return 'expired';
  if (product.openedDate && product.afterOpening > 0) {
    const remaining = daysUntil(addDays(product.openedDate, Number(product.afterOpening)));
    if (remaining !== null && remaining < 0) return 'expired';
    if (remaining !== null && remaining <= 3) return 'opened';
  }
  if (days !== null && days <= 3) return 'soon';
  return 'fresh';
}

function addDays(dateString, amount) {
  const d = new Date(`${dateString}T00:00:00`);
  d.setDate(d.getDate() + Number(amount || 0));
  return d.toISOString().slice(0, 10);
}

function statusText(product) {
  const days = daysUntil(product.expirationDate);
  if (days === null) return 'No expiration date';
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  return `Expires in ${days} days`;
}

function formatDate(dateString) {
  if (!dateString) return '—';
  const date = new Date(`${dateString}T00:00:00`);
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function productVisual(product, small = false) {
  const emoji = categoryEmoji[product.category] || '🍴';
  if (product.image) {
    return `<div class="${small ? 'row-icon' : 'food-image'}" style="background-image:url('${escapeHtml(product.image)}')"></div>`;
  }
  return `<div class="${small ? 'row-icon' : 'food-image'}">${emoji}</div>`;
}

function notify(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function navigate(page) {
  state.currentPage = page;
  document.querySelectorAll('.page').forEach((el) => el.classList.toggle('active', el.id === `page-${page}`));
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.page === page));

  const labels = {
    dashboard: ['Good afternoon.', 'Here is what needs your attention today.'],
    food: ['Your kitchen, organized.', 'Track what you have before it gets forgotten.'],
    recipes: ['Let’s cook before it expires.', 'The AI uses your inventory to suggest practical recipes.'],
    storage: ['Store it smarter.', 'Simple guidance for keeping common foods fresh.']
  };
  $('pageTitle').textContent = labels[page][0];
  $('pageSubtitle').textContent = labels[page][1];
  renderAll();
}

function openModal(id) {
  $(id).classList.remove('hidden');
}

function closeModal(id) {
  $(id).classList.add('hidden');
  if (id === 'scannerModal') stopCamera();
}

function resetProductForm(product = null) {
  $('productForm').reset();
  $('productId').value = product?.id || '';
  $('productBarcode').value = product?.barcode || '';
  $('productImage').value = product?.image || '';
  $('productSource').value = product?.source || '';
  $('productName').value = product?.name || '';
  $('productBrand').value = product?.brand || '';
  $('productCategory').value = product?.category || 'other';
  $('expirationDate').value = product?.expirationDate || '';
  $('storageSelect').value = product?.storage || 'Refrigerator';
  $('afterOpening').value = product?.afterOpening ?? '';
  $('purchaseDate').value = product?.purchaseDate || todayISO();

  const isKnownProduct = Boolean(product?.knownProduct);
  const source = product?.source
    ? isKnownProduct
      ? `Shelfly already knows this product. You only need to confirm the details for this new unit, especially the expiration date.`
      : `Identified via ${product.source}. Verify the package before saving.`
    : 'Enter the details Shelﬂy needs to track this food.';
  $('productSourceNote').textContent = source;
  $('productModalTitle').textContent = product?.id
    ? 'Edit food'
    : isKnownProduct
      ? `Add another ${product.name}`
      : 'Product details';

  const preview = $('productPreview');
  if (product?.name) {
    preview.classList.remove('hidden');
    preview.innerHTML = `${productVisual(product, true)}<div><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.brand || 'Known product')} · ${escapeHtml(product.source || 'Shelfly memory')}</span></div>`;
  } else {
    preview.classList.add('hidden');
    preview.innerHTML = '';
  }
}

function openAddModal(product = null) {
  resetProductForm(product);
  openModal('productModal');

  // For a product Shelﬂy already knows, the user's first task is the package expiration date.
  setTimeout(() => {
    if (product?.knownProduct) $('expirationDate').focus();
    else $('productName').focus();
  }, 50);
}

function saveProductFromForm(event) {
  event.preventDefault();
  const product = {
    id: $('productId').value || uid(),
    barcode: $('productBarcode').value.trim(),
    name: $('productName').value.trim(),
    brand: $('productBrand').value.trim(),
    category: $('productCategory').value,
    expirationDate: $('expirationDate').value,
    storage: $('storageSelect').value,
    afterOpening: $('afterOpening').value === '' ? null : Number($('afterOpening').value),
    purchaseDate: $('purchaseDate').value || todayISO(),
    openedDate: null,
    image: $('productImage').value.trim(),
    source: $('productSource').value.trim() || 'Manual entry',
    createdAt: new Date().toISOString()
  };

  const existingIndex = state.products.findIndex((item) => item.id === product.id);
  if (existingIndex >= 0) {
    product.openedDate = state.products[existingIndex].openedDate || null;
    product.createdAt = state.products[existingIndex].createdAt || product.createdAt;
    state.products[existingIndex] = product;
    notify('Food updated.');
  } else {
    state.products.unshift(product);
    notify(`${product.name} added to My Food.`);
  }

  // The barcode becomes a reusable product memory. The package-specific expiration
  // and opened date stay in the inventory item, while fixed product data is remembered.
  rememberProduct(product);
  saveProducts();
  closeModal('productModal');
  navigate('food');
}

function openProductForEdit(id) {
  const product = state.products.find((item) => item.id === id);
  if (!product) return;
  openAddModal(product);
}

function deleteProduct(id) {
  const product = state.products.find((item) => item.id === id);
  if (!product) return;
  state.products = state.products.filter((item) => item.id !== id);
  saveProducts();
  renderAll();
  notify(`${product.name} removed.`);
}

function markOpened(id) {
  const product = state.products.find((item) => item.id === id);
  if (!product) return;
  product.openedDate = product.openedDate ? null : todayISO();
  saveProducts();
  renderAll();
  notify(product.openedDate ? `${product.name} marked as opened.` : `${product.name} marked as unopened.`);
}

function renderDashboard() {
  const expiring = [...state.products]
    .filter((p) => statusFor(p) === 'soon' || statusFor(p) === 'opened')
    .sort((a, b) => (daysUntil(a.expirationDate) ?? 999) - (daysUntil(b.expirationDate) ?? 999));

  $('totalProducts').textContent = state.products.length;
  $('expiringProducts').textContent = expiring.length;
  $('savedCount').textContent = state.saved;

  if (!expiring.length) {
    $('expiringGrid').innerHTML = `<div class="empty-state"><strong>Your kitchen is looking good.</strong><br>Add foods to see what needs to be used first.</div>`;
    return;
  }

  $('expiringGrid').innerHTML = expiring.slice(0, 4).map((product) => {
    const status = statusFor(product);
    return `<article class="food-card">
      ${productVisual(product)}
      <div class="food-card-body">
        <div class="food-card-title">${escapeHtml(product.name)}</div>
        <div class="food-card-meta">${escapeHtml(product.brand || product.category || 'Kitchen item')}</div>
        <span class="badge ${status}">${escapeHtml(statusText(product))}</span>
      </div>
    </article>`;
  }).join('');
}

function renderFoodList() {
  const query = $('foodSearch').value.trim().toLowerCase();
  const filter = $('foodFilter').value;
  const filtered = state.products.filter((product) => {
    const haystack = `${product.name} ${product.brand} ${product.category}`.toLowerCase();
    if (query && !haystack.includes(query)) return false;
    const status = statusFor(product);
    if (filter === 'all') return true;
    if (filter === 'opened') return Boolean(product.openedDate);
    return status === filter;
  });

  if (!filtered.length) {
    $('foodList').innerHTML = `<div class="empty-state"><strong>No foods found.</strong><br>Try another search or add a new product.</div>`;
    return;
  }

  $('foodList').innerHTML = filtered.map((product) => {
    const status = statusFor(product);
    const openedLabel = product.openedDate ? `Opened ${formatDate(product.openedDate)}` : 'Not opened';
    const brand = product.brand ? `${escapeHtml(product.brand)} · ` : '';
    return `<article class="food-row">
      ${productVisual(product, true)}
      <div class="row-info">
        <strong>${escapeHtml(product.name)}</strong>
        <small>${brand}${escapeHtml(product.category || 'other')}</small>
      </div>
      <div class="row-date">${escapeHtml(statusText(product))}</div>
      <div class="row-date">${escapeHtml(openedLabel)}</div>
      <div>
        <button class="icon-btn" title="Mark opened" onclick="markOpened('${product.id}')">${product.openedDate ? '↺' : '✓'}</button>
        <button class="icon-btn" title="Edit" onclick="openProductForEdit('${product.id}')">✎</button>
        <button class="icon-btn" title="Delete" onclick="deleteProduct('${product.id}')">×</button>
      </div>
    </article>`;
  }).join('');
}

function renderRecipes() {
  let recipes = [];
  try { recipes = JSON.parse(localStorage.getItem(RECIPES_KEY) || '[]'); } catch { recipes = []; }

  if (!recipes.length) {
    $('recipeGrid').innerHTML = `<div class="recipe-empty"><strong>Your kitchen is ready.</strong><br>Add a few foods, then generate personalized recipe ideas.</div>`;
    return;
  }

  $('recipeGrid').innerHTML = recipes.map((recipe) => `
    <article class="recipe-card">
      <div class="recipe-top">
        <div><h3>${escapeHtml(recipe.title)}</h3><p class="recipe-description">${escapeHtml(recipe.description)}</p></div>
      </div>
      <div class="recipe-meta">
        <span class="recipe-pill">⏱ ${escapeHtml(recipe.time_minutes)} min</span>
        <span class="recipe-pill">${escapeHtml(recipe.difficulty)}</span>
        ${recipe.mode ? `<span class="recipe-pill recipe-pill-demo">${escapeHtml(recipe.mode)}</span>` : ''}
      </div>
      <div class="recipe-columns">
        <div>
          <div class="recipe-section-title">INGREDIENTS</div>
          <ul>${recipe.ingredients.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        </div>
        <div>
          <div class="recipe-section-title">STEPS</div>
          <ol>${recipe.steps.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>
        </div>
      </div>
      <div class="priority-note"><strong>Uses from your kitchen:</strong> ${escapeHtml((recipe.uses_products || []).join(', '))}<br><strong>Why now:</strong> ${escapeHtml(recipe.priority_reason || 'Uses ingredients already in your kitchen.')}</div>
    </article>`).join('');
}

function validRecipeProducts() {
  return state.products
    .filter((product) => statusFor(product) !== 'expired')
    .sort((a, b) => (daysUntil(a.expirationDate) ?? 999) - (daysUntil(b.expirationDate) ?? 999));
}

function byCategory(products, categories) {
  return products.find((product) => categories.includes(product.category));
}

function uniqueProducts(products) {
  const seen = new Set();
  return products.filter((product) => {
    if (!product || seen.has(product.id)) return false;
    seen.add(product.id);
    return true;
  });
}

function expiryReason(products) {
  const urgent = products.find((product) => {
    const days = daysUntil(product.expirationDate);
    return days !== null && days <= 3;
  });
  if (!urgent) return 'Uses ingredients already in your kitchen.';
  const days = daysUntil(urgent.expirationDate);
  if (days < 0) return 'Use the ingredients with the nearest valid dates first.';
  if (days === 0) return `${urgent.name} reaches its date today.`;
  if (days === 1) return `${urgent.name} reaches its date tomorrow.`;
  return `${urgent.name} reaches its date in ${days} days.`;
}

function makeDemoRecipe(title, description, time, difficulty, products, ingredients, steps) {
  const used = uniqueProducts(products);
  return {
    title,
    description,
    time_minutes: time,
    difficulty,
    ingredients,
    steps,
    uses_products: used.map((product) => product.name),
    priority_reason: expiryReason(used),
    mode: 'SMART DEMO'
  };
}

function generateDemoRecipes() {
  const products = validRecipeProducts();
  if (!products.length) return [];

  const eggs = byCategory(products, ['eggs']);
  const cheese = byCategory(products, ['cheese']);
  const dairy = byCategory(products, ['dairy']);
  const rice = products.find((product) => product.category === 'grains' && /rice|arroz/i.test(product.name));
  const pasta = products.find((product) => product.category === 'grains' && /pasta|massa|noodle|macarr/i.test(product.name));
  const meat = byCategory(products, ['meat']);
  const vegetables = byCategory(products, ['vegetables']);
  const fruit = byCategory(products, ['fruit']);
  const snacks = byCategory(products, ['snacks']);
  const beverage = byCategory(products, ['beverage']);
  const recipes = [];

  if (eggs && (cheese || vegetables || meat)) {
    const main = uniqueProducts([eggs, cheese, vegetables, meat].filter(Boolean));
    recipes.push(makeDemoRecipe(
      'Quick Kitchen Omelette',
      'A fast way to use eggs together with ingredients already in your kitchen.',
      10, 'Easy', main,
      [eggs.name, cheese ? cheese.name : vegetables ? vegetables.name : meat.name, 'Salt and pepper', 'A little cooking oil'],
      ['Beat the eggs with salt and pepper.', 'Cook the filling in a lightly oiled pan.', 'Add the eggs and cook until set.', 'Fold the omelette and serve hot.']
    ));
  }

  if (rice && (eggs || meat || vegetables)) {
    const main = uniqueProducts([rice, vegetables, eggs, meat].filter(Boolean));
    const extras = main.slice(1, 3).map((p) => p.name);
    recipes.push(makeDemoRecipe(
      'Use-It-Up Fried Rice',
      'Turn leftover or near-date ingredients into a simple one-pan meal.',
      20, 'Easy', main,
      [rice.name, ...extras, eggs ? eggs.name : null, 'A little cooking oil'].filter(Boolean),
      ['Cook or reheat the rice until hot.', 'Cook the vegetables or meat in a pan.', eggs ? 'Add the egg and scramble it with the other ingredients.' : 'Stir the ingredients together until heated through.', 'Add the rice, mix well and serve.']
    ));
  }

  if (pasta && (cheese || dairy || vegetables || meat)) {
    const main = uniqueProducts([pasta, cheese, dairy, vegetables, meat].filter(Boolean));
    const sauce = cheese ? cheese.name : dairy ? dairy.name : vegetables ? vegetables.name : meat.name;
    recipes.push(makeDemoRecipe(
      'Simple Pantry Pasta',
      'A flexible pasta dish designed around the ingredients Shelﬂy sees in your kitchen.',
      25, 'Easy', main,
      [pasta.name, sauce, vegetables ? vegetables.name : null, meat ? meat.name : null, 'Salt and pepper'].filter(Boolean),
      ['Cook the pasta according to the package instructions.', 'Cook the selected filling in a pan.', 'Combine the pasta with the filling and add the selected dairy or cheese ingredient when appropriate.', 'Season and serve.']
    ));
  }

  if (fruit && (dairy || beverage)) {
    const main = uniqueProducts([fruit, dairy, beverage].filter(Boolean));
    recipes.push(makeDemoRecipe(
      'Fresh Fruit Bowl',
      'A no-cook option for using fruit before it becomes overripe.',
      5, 'Easy', main,
      [fruit.name, dairy ? dairy.name : beverage.name],
      ['Wash and cut the fruit as appropriate.', 'Add the dairy product or serve it alongside the fruit.', 'Serve immediately and follow package storage instructions for leftovers.']
    ));
  }

  if (snacks && fruit) {
    const main = uniqueProducts([snacks, fruit]);
    recipes.push(makeDemoRecipe(
      'Snack & Fruit Parfait',
      'A simple layered snack that combines foods already in Shelﬂy.',
      5, 'Easy', main,
      [fruit.name, snacks.name],
      ['Prepare the fruit.', 'Layer the fruit with the snack ingredient.', 'Serve immediately for the best texture.']
    ));
  }

  if (!recipes.length) {
    const main = products.slice(0, 4);
    recipes.push(makeDemoRecipe(
      'Shelfly Kitchen Mix',
      'A flexible idea built from the foods currently available in your kitchen.',
      20, 'Easy', main,
      main.map((product) => product.name),
      ['Choose the ingredients that work well together.', 'Cook or prepare them according to their package instructions.', 'Season with ordinary pantry basics if needed.', 'Serve and refrigerate leftovers promptly.']
    ));
  }

  return recipes.slice(0, 5);
}

function renderStorage() {
  $('storageGrid').innerHTML = storageTips.map(([icon, title, text]) => `
    <article class="storage-card">
      <div class="storage-icon">${icon}</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text)}</p>
    </article>`).join('');
}

function renderNotifications() {
  const urgent = state.products
    .filter((p) => statusFor(p) === 'soon' || statusFor(p) === 'opened' || statusFor(p) === 'expired')
    .sort((a, b) => (daysUntil(a.expirationDate) ?? 999) - (daysUntil(b.expirationDate) ?? 999));

  $('notificationDot').style.display = urgent.length ? 'block' : 'none';
  $('notificationList').innerHTML = urgent.length
    ? urgent.slice(0, 8).map((product) => `<div class="notification-item"><strong>${escapeHtml(product.name)}</strong>${escapeHtml(statusText(product))}. Consider using it soon.</div>`).join('')
    : `<div class="empty-state">No food alerts right now.</div>`;
}

function renderAll() {
  renderDashboard();
  renderFoodList();
  renderRecipes();
  renderStorage();
  renderNotifications();
}

async function lookupBarcode(barcode) {
  const cleaned = String(barcode || '').replace(/\D/g, '');
  if (!cleaned) {
    notify('Enter a barcode first.');
    return;
  }

  $('cameraStatus').textContent = `Checking your Shelﬂy memory for ${cleaned}...`;

  // First check what Shelﬂy already knows. This avoids another database lookup
  // and avoids asking the user to fill in the same product information again.
  const known = findKnownProduct(cleaned);
  if (known) {
    stopCamera();
    closeModal('scannerModal');
    openAddModal({
      ...known,
      id: '',
      barcode: cleaned,
      expirationDate: '',
      purchaseDate: todayISO(),
      openedDate: null,
      knownProduct: true,
      source: known.source || 'Shelfly memory'
    });
    notify(`Known product: ${known.name}`);
    return;
  }

  $('cameraStatus').textContent = `Looking up ${cleaned}...`;

  try {
    const response = await fetch(`/api/products/${encodeURIComponent(cleaned)}`);
    const data = await response.json();

    if (!response.ok) throw new Error(data.error || 'Product lookup failed.');

    if (!data.found) {
      $('cameraStatus').textContent = 'Product not found — you can add it manually.';
      notify('Product not found. Enter its name manually.');
      openAddModal({ barcode: cleaned, category: 'other', storage: 'Refrigerator', purchaseDate: todayISO() });
      return;
    }

    const found = data.product;
    stopCamera();
    closeModal('scannerModal');
    openAddModal({
      id: '',
      barcode: found.barcode,
      name: found.name,
      brand: found.brand,
      category: found.category,
      image: found.image,
      source: found.source,
      storage: found.category === 'grains' || found.category === 'snacks' ? 'Pantry' : 'Refrigerator',
      purchaseDate: todayISO()
    });
    notify(`Found: ${found.name}`);
  } catch (error) {
    console.error(error);
    $('cameraStatus').textContent = 'Could not look up the barcode.';
    notify(error.message || 'Barcode lookup failed.');
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    $('cameraStatus').textContent = 'Camera is not supported here. Use the barcode field below.';
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
    $('cameraVideo').srcObject = state.stream;
    $('cameraVideo').style.display = 'block';
    await $('cameraVideo').play();

    if ('BarcodeDetector' in window) {
      const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
      try { state.detector = new BarcodeDetector({ formats }); } catch { state.detector = new BarcodeDetector(); }
      state.scanning = true;
      $('cameraStatus').textContent = 'Point the camera at a barcode.';
      scanFrame();
    } else {
      $('cameraStatus').textContent = 'Camera is on. Your browser does not support automatic barcode detection; type the code below.';
    }
  } catch (error) {
    console.error(error);
    $('cameraStatus').textContent = 'Camera permission was denied or unavailable.';
  }
}

async function scanFrame() {
  if (!state.scanning || !state.detector) return;
  try {
    const codes = await state.detector.detect($('cameraVideo'));
    if (codes?.length && codes[0].rawValue) {
      state.scanning = false;
      $('barcodeInput').value = codes[0].rawValue;
      await lookupBarcode(codes[0].rawValue);
      return;
    }
  } catch (error) {
    console.debug('Barcode detection:', error.message);
  }
  requestAnimationFrame(scanFrame);
}

function stopCamera() {
  state.scanning = false;
  state.detector = null;
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }
  const video = $('cameraVideo');
  if (video) {
    video.pause();
    video.srcObject = null;
    video.style.display = 'none';
  }
  if ($('cameraStatus')) $('cameraStatus').textContent = 'Camera ready';
}

async function generateRecipes() {
  const button = $('generateRecipesBtn');
  const status = $('recipeStatus');

  if (!state.products.length) {
    status.className = 'recipe-status error';
    status.textContent = 'Add at least one food to My Food first.';
    return;
  }

  button.disabled = true;
  button.textContent = '✦ Generating with Gemini...';
  status.className = 'recipe-status';
  status.textContent = 'Gemini is checking your kitchen and prioritizing the foods that should be used first.';

  const products = state.products.map((product) => ({
    name: product.name,
    brand: product.brand,
    category: product.category,
    expirationDate: product.expirationDate,
    openedDate: product.openedDate,
    afterOpening: product.afterOpening,
    storage: product.storage
  }));

  try {
    const response = await fetch('/api/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ products })
    });
    const data = await response.json();

    if (!response.ok) {
      const error = new Error(data.error || 'Recipe generation failed.');
      error.status = response.status;
      throw error;
    }

    const aiRecipes = (data.recipes || []).map((recipe) => ({ ...recipe, mode: 'AI' }));
    localStorage.setItem(RECIPES_KEY, JSON.stringify(aiRecipes));
    renderRecipes();
    status.className = 'recipe-status';
    status.textContent = data.kitchen_note || 'Recipes generated from your kitchen with Gemini.';
    notify('Your Gemini recipes are ready.');
  } catch (error) {
    console.error('Gemini recipe generation failed; using demo mode:', error);

    // The presentation should keep working even when Gemini is temporarily unavailable.
    // We only fall back for API/auth/billing/network failures; the recipes are
    // clearly labeled as SMART DEMO so the UI never pretends local generation is AI.
    const demoRecipes = generateDemoRecipes();

    if (demoRecipes.length) {
      localStorage.setItem(RECIPES_KEY, JSON.stringify(demoRecipes));
      renderRecipes();
      status.className = 'recipe-status demo';
      if (error.status === 429 || /credits|quota|billing|rate limit/i.test(error.message || '')) {
        status.textContent = 'Gemini is currently unavailable. Shelﬂy switched to Smart Demo Mode, using the foods in your inventory to generate recipe ideas locally.';
      } else {
        status.textContent = 'The Gemini service is unavailable right now. Shelﬂy switched to Smart Demo Mode so the presentation can continue.';
      }
      notify('Smart Demo Mode is active.');
    } else {
      status.className = 'recipe-status error';
      status.textContent = 'Add a few non-expired foods so Shelﬂy can build a recipe suggestion.';
      notify('No usable foods for recipes.');
    }
  } finally {
    button.disabled = false;
    button.textContent = '✦ Generate with Gemini';
  }
}

function setupEvents() {
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.page)));

  $('scanTopBtn').addEventListener('click', () => openModal('scannerModal'));
  $('quickScan').addEventListener('click', () => openModal('scannerModal'));
  $('addFoodBtn').addEventListener('click', () => openAddModal());
  $('quickAdd').addEventListener('click', () => openAddModal());
  $('quickRecipes').addEventListener('click', () => navigate('recipes'));
  $('dashboardRecipesBtn').addEventListener('click', () => navigate('recipes'));
  $('viewAllFoodBtn').addEventListener('click', () => navigate('food'));
  $('generateRecipesBtn').addEventListener('click', generateRecipes);
  $('foodSearch').addEventListener('input', renderFoodList);
  $('foodFilter').addEventListener('change', renderFoodList);
  $('startCameraBtn').addEventListener('click', startCamera);
  $('stopCameraBtn').addEventListener('click', stopCamera);
  $('lookupBarcodeBtn').addEventListener('click', () => lookupBarcode($('barcodeInput').value));
  $('barcodeInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') lookupBarcode($('barcodeInput').value);
  });
  $('demoMilkBtn').addEventListener('click', () => {
    const future = addDays(todayISO(), 6);
    stopCamera();
    closeModal('scannerModal');
    openAddModal({
      id: '',
      barcode: '7891000315507',
      name: 'Fresh Milk',
      brand: 'Demo Brand',
      category: 'dairy',
      expirationDate: future,
      storage: 'Refrigerator',
      afterOpening: 3,
      purchaseDate: todayISO(),
      source: 'Shelfly Demo'
    });
  });

  $('productForm').addEventListener('submit', saveProductFromForm);
  $('notificationButton').addEventListener('click', () => $('notificationDrawer').classList.toggle('hidden'));
  $('closeNotifications').addEventListener('click', () => $('notificationDrawer').classList.add('hidden'));

  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.close)));
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeModal(backdrop.id);
  }));
}

window.openProductForEdit = openProductForEdit;
window.deleteProduct = deleteProduct;
window.markOpened = markOpened;

seedCatalogFromInventory();
setupEvents();
renderAll();
