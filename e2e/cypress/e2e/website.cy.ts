describe('Blog tests', () => {
  it('Visits the home of my blog', () => {
    cy.visit('/')

    cy.get('[class*="category"]').should('have.length', 3)
    
  }),
  it('Visits all posts', () => {
    cy.visit('/post')

    cy.get('[class="h5 d-block my-3"]').should('have.length', 8)
    
  }),
  it('Visits About', () => {
    cy.visit('/about')

    cy.contains('Moin Moin')
    
  }),
  it('Visits taxonomy pulumi', () => {
    cy.visit('/tags/pulumi/')

    cy.get('[class="h5 d-block my-3"]').should('have.length', 5)

  }),
  it("Visits post CQRS/ES backend", () => {
    cy.visit('/post/cqrs-es-kotlin-backend/')

    cy.get('[id="concepts"]').should("have.text", "Concepts")
  })
})