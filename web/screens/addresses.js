// Address book stub. Real content (list / add / edit / archive) lands in the
// next M6 tasks — we're wiring the routing here so the shell commit is
// self-contained.

export function addressesListScreen(root) {
  root.innerHTML = `
    <section class="screen">
      <div class="loading">Address book lands in the next commit.</div>
    </section>
  `;
  return {
    title: 'Addresses',
    tab: 'log',
    showBack: true,
    primary: { label: '+', href: '#/addresses/new', ariaLabel: 'Add address' },
  };
}

export function addressAddScreen(root) {
  root.innerHTML = `
    <section class="screen">
      <div class="loading">Add-address form lands in the next commit.</div>
    </section>
  `;
  return { title: 'New Address', tab: 'log', showBack: true, primary: null };
}

export function addressEditScreen(root, params) {
  root.innerHTML = `
    <section class="screen">
      <div class="loading">Edit-address form lands in the next commit (id=${params.id}).</div>
    </section>
  `;
  return { title: 'Edit Address', tab: 'log', showBack: true, primary: null };
}
