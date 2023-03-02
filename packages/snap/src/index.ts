import { OnRpcRequestHandler, OnTransactionHandler } from '@metamask/snaps-types';
import { panel, text, heading, NodeType, Panel, divider } from '@metamask/snaps-ui';
import { Json, isObject, hasProperty } from '@metamask/utils';


// todo: use handlers, utils, formatters
// todo: make test cases that are easy to run

export const onRpcRequest: OnRpcRequestHandler = async ({ origin, request }) => {
  switch (request.method) {
    case 'update_tenderly_access_key':
      // todo: check the origin in correct
      // todo: also project id and user id should be updated
      const newTenderlyAccessKey = await snap.request({
        method: 'snap_dialog',
        params: {
          type: 'Prompt',
          content: panel([
            heading(`${origin} wants to update the Tenderly access key`),
            text('Enter the new Tenderly access key:'),
          ]),
          placeholder: 'WdMLIQ...',
        },
      });

      return await snap.request({
        method: 'snap_manageState',
        params: { 
          operation: 'update', 
          newState: {
            tenderlyAccessKey: newTenderlyAccessKey
          }},
      });
    default:
      throw new Error(`Method ${request.method} not supported.`);
  }
};

export const onTransaction: OnTransactionHandler = async ({transaction, transactionOrigin}) => {
  if (
    !isObject(transaction) ||
    !hasProperty(transaction, 'data') ||
    typeof transaction.data !== 'string'
  ) {
    return { 
      content: {
        value: "Unknown tx typet",
        type: NodeType.Text
      }
    }
  }
  let value = await getTenderlySimulation(transaction, transactionOrigin);
  return {
    content: {
      children: value.children,
      type: NodeType.Panel
    }
  };
}


async function getTenderlySimulation(transaction: { [key: string]: Json;}, transactionOrigin: any): Promise<Panel> {
  console.log(transaction)

  const persistedData: any = await snap.request({
    method: 'snap_manageState',
    params: { operation: 'get' },
  });
  console.log('getting tenderly access key')
  if (!persistedData.tenderlyAccessKey) {
    snap.request({
      method: 'snap_dialog',
      params: {
        type: 'Prompt',
        content: panel([
          heading(`${transactionOrigin} wants to update the Tenderly access key`),
          text('Enter the new Tenderly access key:'),
        ]),
        placeholder: 'WdMLIQ...',
      },
    }).then(async (newAccessKey) => {
      await snap.request({
        method: 'snap_manageState',
        params: { 
          operation: 'update', 
          newState: {
            tenderlyAccessKey: newAccessKey
          }},
      });
    })
    return panel([text('🚨 Tenderly access key updated. Please try again.')])

  }
    // todo: move this into local storage
    const TENDERLY_USER = 'eden-network';
    const TENDERLY_PROJECT = 'playground';
    const TENDERLY_ACCESS_KEY = persistedData.tenderlyAccessKey;
    // todo: delete

  const hex2int = (hex: string | Json) => hex ? parseInt(hex.toString(), 16) : null;

  const resp = await fetch(
    `https://api.tenderly.co/api/v1/account/${TENDERLY_USER}/project/${TENDERLY_PROJECT}/simulate`,
    {
        method: 'POST', 
        body: JSON.stringify({
          save: false,
          save_if_fails: true,
          simulation_type: 'full',
          generate_access_list: true,
          block_number: 16226878, // todo: rm this
          // gas_price: hex2int(transaction.maxFeePerGas), // todo: this is not right!!
          network_id: hex2int(ethereum.chainId),
          from: transaction.from,
          input: transaction.data,
          to: transaction.to,
          gas: hex2int(transaction.gas),
          value: hex2int(transaction.value),
        }),
        headers: {
            'Content-Type': 'application/json',
            'X-Access-Key': TENDERLY_ACCESS_KEY
        }
      }
  )
  console.log(resp)
  const data = await resp.json();

  if (!data.transaction) {
    if (data.error) {
      return panel([
        text(`**${data.error.slug}:**`), 
        divider(), 
        text(data.error.message)
      ])
    }
    return panel([text('Invalid response 😬')])
  } else if (data.transaction.error_info) {
    return panel([
      text(`**${data.transaction.error_info.address}:**`),
      divider(),
      text(data.transaction.error_info.error_message)
    ])
  }

  
  // todo: what if no state changes/no call trace?

  // todo: use call method and contract name!

  const callTrace = data.transaction.transaction_info.call_trace;
  const logs = data.transaction.transaction_info.logs;

  let panelOutputs = [];

  panelOutputs.push(heading('Balance changes:'));
  

  callTrace.balance_diff
    .forEach(
      (balance: any) => {
        panelOutputs.push(text(`**${balance.address}${
          balance.is_miner ? '(Miner)' : balance.address == data.transaction.from ? '(Sender)' : balance.address == data.transaction.to ? '(Receiver)' : ''
        }**: ${balance.original} -> ${balance.dirty}`))
        panelOutputs.push(divider())
      }            
  )

  panelOutputs.push(heading('Output value:'));
  callTrace.decoded_output
    .forEach(
      (output: any) => {
        panelOutputs.push(text(`__${output.soltype.name} ${output.soltype.type}__ = ${JSON.stringify(
          output.value
        )}`))
        panelOutputs.push(divider())
      }
    )

    panelOutputs.push(heading('Events:'));
    panelOutputs.push(divider())
    logs
      .forEach(
        (log: any) => {
          let res = `${log.name} (${log.inputs
            .map(
              (input: any) =>
                `${input.soltype.name} ${input.soltype.type} = ${input.value}`
            )
            .join(', ')})`;
            panelOutputs.push(text(res))
            panelOutputs.push(divider())
        }
      )

  panelOutputs.push(heading('State changes:'));
  const stateDiff = data.transaction.transaction_info.state_diff;
  stateDiff
    .forEach(
      (diff: any) => {
        let res = `**${diff.address}**
__${diff.soltype.name}: ${diff.soltype.type}__
${JSON.stringify(diff.original)} -> ${JSON.stringify(diff.dirty)}
` 
        panelOutputs.push(text(res))
        panelOutputs.push(divider())

      }
    );

  return panel(panelOutputs);
}
