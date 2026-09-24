/*
 * Until the server exists, forms marked data-next just move on to the next
 * screen of the flow instead of posting anywhere.
 */
for (const form of document.querySelectorAll<HTMLFormElement>('form[data-next]')) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    location.href = form.dataset.next!;
  });
}
