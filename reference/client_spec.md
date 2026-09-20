# Client specification — Ato Eyob, Prime Hospitality Business Group

The client's own description of the system, sheet by sheet, in his words.
Lightly formatted; wording and figures unchanged.

**Integration note:** the web app is expected to work alongside two third-party
systems — Peachtree for accounting/reporting, and CNET for POS/sales.

---

## Cover

It guides the user, how to use the system.

## Item Master

Shows total items of the company by category. For example: (Food, Meat,
Beef...), (Beverage, Water, Coffee...), (Others, To-go box, Napkin...).
This sheet should get information from the Purchase or Receiving.

## Purchase

Every purchase should be recorded here by Item name, UOM, Qty and price. The
purchaser should make a purchase order and it should be approved.

## Receiving

Any items purchased should pass through the receiving process. Upon receiving,
the user of the item, the store keeper and the F&B cost controller should
approve the purchase before it goes to the store.

## Main Store

Under main store there are categories: Main store food, Main store beverage,
Main store general. For all items in all categories there needs to be a minimum
and maximum par level alert that tells the store keeper and the manager.

## Outlet Kitchen

Will issue food and other related items from the main store. There need to be
three authorization levels. Once the last manager approves, the store keeper
will release the requested items to the requester. The items will be deducted
from the main store and added to the requester's store.

## Outlet Bar

Works the same as the kitchen above.

## Issue Transfer

The store keeper pulls all approved items and fills a transfer from his store to
the requester. The requester then approves the transfer and receives it. This is
the point at which items are reduced from the main store and added to the
requester outlet.

## Inter-Outlet Transfer

Either the bar or the kitchen may need to borrow an item from the other.
Instead of issuing, they use an inter-transfer — bar to kitchen, kitchen to bar,
or one outlet to another. When the request is made, F&B control should approve,
so the item is reduced from the provider and added to the receiver
automatically.

## Recipe — Food

Guidance that tells which items in what quantity make a specific product.
Example:

    Menu item name: Burger
    Portion: 1

    Ingredients    UOM    Qty      UC      USC
    Beef Patty     KG     0.100    1000    100
    Cheese         KG     0.100     500     50
                                          ----
    Total                                   150

This means we are making a burger for a single person. The ingredients are beef
and cheese, both measured in KG. To make one burger we use 100g of beef and 100g
of cheese. The unit cost for 1kg of beef is 1000 birr and 1kg of cheese is 500
birr. Usage cost = quantity × unit cost. Adding the total ingredient cost gives
the cost of the item — here, 150 birr to make one burger.

## Recipe — Beverage

Same logic as food.

**Recipes are managed only by the F&B cost controller.**

## Inventory — Store

The main store should have a beginning inventory, and whenever purchased items
are received they are added by item name, date, quantity and other information.
This gives detailed stock on hand by item, quantity, unit cost, and total stock
on hand value.

## Inventory — Kitchen

There is a beginning inventory for the kitchen. Whenever items are received from
the store they are added by date, item, quantity and other information as above.

## Inventory — Bar

Same as the kitchen.

## Month End Inventory

The main store, kitchen store and bar store are counted on the last day of every
month, by item name, qty, unit price, total price, theoretical and actual cost.
Theoretical cost comes by default; actual cost is established by physical count.
Deviation must be justified. There should be an adjustment, filled in by the
Finance Manager. The final believed balance becomes the beginning inventory of
the next month automatically.

## Stock Ledger

Shows the bar, kitchen and store inventory that is supposed to be available,
with an open column to enter actual inventory. The variance between potential
and actual is the Deviation. For both shortages and overages, section heads must
justify to the F&B Cost Controller.

## Sales by Item

Menu item names with selling price before service charge and VAT. Sales are
categorised by Food and Beverage separately, as their recipes are made
separately. For example:

    Item name    S.P    Qty    SC     VAT      TR
    Burger       100     1     10     16.5     126.5

One burger before 10% service charge and 15% VAT is 100. Service charge is
100 × 10% = 10. As government considers service charge as revenue, VAT is 15%
of the sum of selling price plus service charge: (100 + 10) × 15% = 16.50.

    Net revenue    = 100 × 1            = 100
    Service charge = 100 × 10% × 1      = 10
    VAT            = (100 + 10) × 15%   = 16.50
    Total revenue  = 100 + 10 + 16.50   = 126.50

## Other Sales

Only to-go materials and items other than F&B are recorded here.

## Sales Summary

Shows total sales for food, total sales of beverage, total other sales, and
grand total sales = food + beverage + other. Both types of sales should be
shown daily or over any date range the administrator requires.

## Key tip

Whenever any sale is made, whether food or beverage, the product is reduced from
its store based on the recipe. The inventory should then show theoretical stock
on hand.

## Wastage

There are known and genuine wastages. The user enters wastage by name and
quantity, and the cost is calculated automatically since the product cost is
known. The F&B Cost Controller must approve the wastage, or may reject it if he
doesn't believe it is realistic. Once approved, the item cost is deducted from
the requester's store.

## Void

Whenever a void is made, the supervisor and kitchen head pre-approve it and the
controller approves finally.

## Food & Beverage Cost Report

Sales of food minus cost of food. Food cost % = cost of food ÷ sales of food.
The same applies for beverage. This works the same for sales by item and sales
by summary.

## Menu Engineering

Shows how many of all items were sold, at what quantity and price, so that from
all items you can rank number 1, 2, 3, 4, 5 and so on.

## Executive Dashboard

All types of report should appear here automatically, in various attractive and
descriptive ways.
