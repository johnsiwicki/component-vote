const input = document.querySelector('.toggle input');
const state = document.querySelector('.toggle .state');
input.addEventListener('change', () => {
  state.textContent = input.checked ? 'On' : 'Off';
});
